/**
 * Outbound-webhook seam (spec §7.6, ADR 0034): SIGNING + DELIVERY only.
 * Deliberately no endpoint-registry table, no delivery log, no controller —
 * the skeleton ships the seam, projects own the feature. The full recipe
 * (registry table sketch, DLQ, replay) lives in this module's README.md.
 *
 * Signature scheme (Stripe-style, `X-Webhook-Signature: t=<unix>,v1=<hex>`):
 * `v1 = HMAC-SHA256(secret, "<t>.<raw body>")`. Binding the timestamp into
 * the MAC kills replay (receivers reject stale `t`), and signing the RAW
 * body string means receivers verify bytes before any JSON parse.
 *
 * SSRF egress guard (REQUIRED control, `common/http/ssrf-guard`): webhook
 * URLs are user-suppliable, so every dispatch — including every manually
 * followed redirect hop — passes TWO layers: (1) the synchronous
 * `assertEgressUrlAllowed` pre-flight (http(s) only; IP-literal hosts must
 * be ordinary global unicast — ALLOWLIST, everything else refused) and
 * (2) a guarded undici dispatcher whose connector validates every
 * DNS-resolved address and connects to that SAME validated resolution
 * (DNS rebinding closed by construction — no second lookup). Opt out per
 * delivery with `allowPrivateNetwork: true` (trusted first-party targets
 * only; the scheme check still applies).
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";

import {
  assertEgressUrlAllowed,
  createSsrfGuardedDispatcher,
  SsrfBlockedError,
} from "../../common/http/ssrf-guard.js";

/** Wire shape of an outbound webhook body (the signed JSON document). */
export interface WebhookEvent {
  /** Outbox event id (uuidv7) — delivery is at-least-once, receivers dedup on it. */
  id: string;
  /** Domain event type, e.g. `project.created`. */
  type: string;
  /** IDs only, never PII (ADR 0037) — receivers re-fetch state via the API. */
  payload: Record<string, unknown>;
}

export interface WebhookDelivery {
  status: number;
  durationMs: number;
}

export interface DeliverOptions {
  /** Per-attempt budget; the receiver gets this long to 2xx. */
  timeoutMs?: number;
  /** Test seam / deterministic replay — defaults to now. */
  timestamp?: number;
  /**
   * Skip the private-address egress guard for this delivery (scheme check
   * still applies). ONLY for trusted first-party targets a project controls
   * (e.g. an internal relay) — never for customer-supplied URLs.
   */
  allowPrivateNetwork?: boolean;
}

/**
 * Thrown on ANY non-success (non-2xx, timeout, network). Deliberately an
 * exception: the relay handler runs inside the `events` BullMQ processor,
 * so a throw IS the retry signal (5 attempts, exponential backoff, then
 * DLQ — ADR 0043). `status` is null when no response arrived at all.
 */
export class WebhookDeliveryError extends Error {
  constructor(
    readonly url: string,
    readonly status: number | null,
    message: string,
  ) {
    super(message);
    this.name = "WebhookDeliveryError";
  }
}

export const WEBHOOK_SIGNATURE_HEADER = "X-Webhook-Signature";
export const WEBHOOK_ID_HEADER = "X-Webhook-Id";

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_TOLERANCE_SECONDS = 300;
/** Manual-follow cap — each hop re-runs the full egress guard. */
const MAX_REDIRECTS = 3;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * Cloud-metadata hostnames blocked without waiting for DNS (their addresses
 * — 169.254.169.254, fd00:ec2::254 — are caught by the allowlist anyway;
 * this just refuses to even resolve them).
 */
const BLOCKED_HOSTNAMES = new Set(["metadata.google.internal", "metadata.goog"]);

@Injectable()
export class WebhookDispatcher {
  private readonly logger = new Logger(WebhookDispatcher.name);

  /**
   * Sign a raw payload string. Returns the full header value
   * (`t=<unix seconds>,v1=<hex hmac>`); pass `timestamp` only for
   * deterministic tests/replays.
   */
  sign(payload: string, secret: string, timestamp: number = unixNow()): string {
    const v1 = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
    return `t=${timestamp},v1=${v1}`;
  }

  /**
   * Receiver-side check (documented in the README for webhook CONSUMERS,
   * and used by the billing-ingestion recipe): constant-time compare +
   * timestamp tolerance. `payload` must be the RAW request body string.
   */
  verify(
    header: string,
    payload: string,
    secret: string,
    { toleranceSeconds = DEFAULT_TOLERANCE_SECONDS, now = unixNow() } = {},
  ): boolean {
    const parts = new Map<string, string>();
    for (const pair of header.split(",")) {
      const eq = pair.indexOf("=");
      if (eq > 0) parts.set(pair.slice(0, eq), pair.slice(eq + 1));
    }
    const t = Number(parts.get("t"));
    const v1 = parts.get("v1");
    if (!Number.isInteger(t) || v1 === undefined || v1.length === 0) return false;
    if (Math.abs(now - t) > toleranceSeconds) return false;

    const expected = createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex");
    const given = Buffer.from(v1, "utf8");
    const want = Buffer.from(expected, "utf8");
    return given.length === want.length && timingSafeEqual(given, want);
  }

  /**
   * One delivery ATTEMPT — retries belong to the caller's queue (the events
   * processor's attempts/backoff, ADR 0043), not to this method. Success =
   * 2xx; everything else throws `WebhookDeliveryError`.
   *
   * Every request — the first AND every redirect hop (`redirect: "manual"`,
   * followed by hand up to MAX_REDIRECTS, re-POSTing the identical signed
   * body) — passes the SSRF pre-flight first, and (unless the caller opted
   * into private egress) connects through ONE guarded dispatcher shared
   * across the hops: its connector validates every DNS-resolved address and
   * dials that SAME validated resolution, so DNS rebinding is CLOSED — a
   * hostile resolver cannot swap answers between check and connect, because
   * there is no second lookup.
   */
  async deliver(
    url: string,
    event: WebhookEvent,
    secret: string,
    options: DeliverOptions = {},
  ): Promise<WebhookDelivery> {
    const timestamp = options.timestamp ?? unixNow();
    // The body embeds the signed timestamp so receivers can log/inspect it;
    // the signature is computed over this EXACT string.
    const body = JSON.stringify({ ...event, timestamp });
    const startedAt = performance.now();
    const allowPrivateNetwork = options.allowPrivateNetwork ?? false;

    // ONE guarded dispatcher per delivery, reused across redirect hops
    // (connection pooling). The opt-out falls back to plain fetch — the
    // guarded connector would refuse to dial the very private address the
    // caller explicitly trusted.
    const egressAgent = allowPrivateNetwork ? undefined : createSsrfGuardedDispatcher();

    try {
      let target = this.guardEgress(url, url, event.id, allowPrivateNetwork);

      for (let redirects = 0; ; redirects++) {
        const init: RequestInit = {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            [WEBHOOK_SIGNATURE_HEADER]: this.sign(body, secret, timestamp),
            [WEBHOOK_ID_HEADER]: event.id,
          },
          body,
          // Never let fetch chase Location itself — each hop below re-runs
          // the full pre-flight, and every hop's connection goes through the
          // same guarded dispatcher.
          redirect: "manual",
          signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
        };
        // `dispatcher` is an undici extension of the runtime fetch (Node's
        // global fetch IS undici). Its type skews across tsconfigs (undici vs
        // the undici-types bundled with @types/node), so attach it through a
        // structural cast — the value is validated at the guard, not here.
        if (egressAgent) {
          (init as Record<string, unknown>).dispatcher = egressAgent;
        }

        let response: Response;
        try {
          response = await fetch(target.href, init);
        } catch (error) {
          // The guarded connector's refusal surfaces as fetch's wrapped
          // `cause` — map it onto the same blocked-shape as the pre-flight.
          const blockedBy = ssrfBlockedCause(error);
          if (blockedBy) {
            this.logger.warn(`webhook ${event.id} to ${url}: blocked (${blockedBy.reason})`);
            throw new WebhookDeliveryError(
              url,
              null,
              `webhook delivery to ${url} blocked: ${blockedBy.message}`,
            );
          }
          const reason = error instanceof Error ? error.message : String(error);
          this.logger.warn(`webhook ${event.id} to ${url}: no response (${reason})`);
          throw new WebhookDeliveryError(url, null, `webhook delivery to ${url} failed: ${reason}`);
        }

        // Release the socket WITHOUT buffering — receivers' response payloads
        // are ignored by contract, and `arrayBuffer()` would let a hostile
        // receiver stream an unbounded body into memory (DoS). `cancel()`
        // discards the body and frees the keep-alive socket.
        await response.body?.cancel().catch(() => undefined);

        if (REDIRECT_STATUSES.has(response.status)) {
          const location = response.headers.get("location");
          if (location !== null && redirects < MAX_REDIRECTS) {
            let next: URL;
            try {
              next = new URL(location, target);
            } catch {
              throw new WebhookDeliveryError(
                url,
                response.status,
                `webhook delivery to ${url} failed: redirect to unparseable Location "${location}"`,
              );
            }
            // Re-POST the identical signed body to the vetted hop (webhooks
            // are not browsers — no GET downgrade on 301/302/303).
            target = this.guardEgress(next.href, url, event.id, allowPrivateNetwork);
            continue;
          }
          const reason =
            location === null
              ? `HTTP ${response.status} without a Location header`
              : `more than ${MAX_REDIRECTS} redirects`;
          this.logger.warn(`webhook ${event.id} to ${url}: ${reason}`);
          throw new WebhookDeliveryError(
            url,
            response.status,
            `webhook delivery to ${url} failed: ${reason}`,
          );
        }

        if (!response.ok) {
          this.logger.warn(`webhook ${event.id} to ${url}: HTTP ${response.status}`);
          throw new WebhookDeliveryError(
            url,
            response.status,
            `webhook delivery to ${url} failed: HTTP ${response.status}`,
          );
        }

        return { status: response.status, durationMs: performance.now() - startedAt };
      }
    } finally {
      // The per-delivery agent holds keep-alive sockets — release them.
      if (egressAgent) await egressAgent.close().catch(() => undefined);
    }
  }

  /**
   * Layer 1 of the SSRF guard, re-run on EVERY hop: parse + scheme +
   * IP-literal allowlist via `assertEgressUrlAllowed`, plus the cheap
   * metadata-hostname pre-block (refuse to even resolve those names).
   * Layer 2 — the rebinding-safe DNS gate for hostname targets — is the
   * guarded dispatcher attached in `deliver`. Failures map onto
   * `WebhookDeliveryError` (status null, `blocked: <reason>` message) so
   * blocked deliveries are recorded/retried/DLQ'd like network failures.
   */
  private guardEgress(
    targetUrl: string,
    deliveryUrl: string,
    eventId: string,
    allowPrivateNetwork: boolean,
  ): URL {
    const blocked = (reason: string): never => {
      this.logger.warn(`webhook ${eventId} to ${deliveryUrl}: blocked (${reason})`);
      throw new WebhookDeliveryError(
        deliveryUrl,
        null,
        `webhook delivery to ${deliveryUrl} blocked: ${reason}`,
      );
    };

    let target: URL;
    try {
      target = assertEgressUrlAllowed(targetUrl, { allowPrivateTargets: allowPrivateNetwork });
    } catch (error) {
      if (error instanceof SsrfBlockedError) return blocked(error.message);
      throw error;
    }
    if (allowPrivateNetwork) return target;

    // WHATWG URL already canonicalized the host; strip IPv6 brackets + the
    // trailing dot of an absolute DNS name before the hostname pre-block.
    const hostname = target.hostname
      .replace(/^\[|\]$/g, "")
      .replace(/\.$/, "")
      .toLowerCase();
    if (BLOCKED_HOSTNAMES.has(hostname)) {
      return blocked(`${hostname} is a cloud-metadata hostname`);
    }
    return target;
  }
}

/**
 * The `SsrfBlockedError` inside a fetch failure, if the guarded connector is
 * what refused the request — undici wraps dispatch errors (`TypeError: fetch
 * failed`) with the underlying error on `cause`, sometimes nested.
 */
function ssrfBlockedCause(error: unknown): SsrfBlockedError | null {
  let current: unknown = error;
  while (current instanceof Error) {
    if (current instanceof SsrfBlockedError) return current;
    current = current.cause;
  }
  return null;
}

function unixNow(): number {
  return Math.floor(Date.now() / 1000);
}
