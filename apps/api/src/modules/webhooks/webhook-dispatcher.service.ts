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
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";

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

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [WEBHOOK_SIGNATURE_HEADER]: this.sign(body, secret, timestamp),
          [WEBHOOK_ID_HEADER]: event.id,
        },
        body,
        signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`webhook ${event.id} to ${url}: no response (${reason})`);
      throw new WebhookDeliveryError(url, null, `webhook delivery to ${url} failed: ${reason}`);
    }

    // Drain the body — receivers' response payloads are ignored by contract,
    // but an undrained body leaks the socket on keep-alive agents.
    await response.arrayBuffer().catch(() => undefined);

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
}

function unixNow(): number {
  return Math.floor(Date.now() / 1000);
}
