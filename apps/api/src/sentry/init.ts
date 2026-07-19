/**
 * Sentry = the "what broke" layer (ADR 0036): errors only — traces belong to
 * OTel (`skipOpenTelemetrySetup`, sample rate 0). Called from the entrypoints
 * BEFORE Nest boots; no-op without SENTRY_DSN. Reads process.env directly
 * (pre-DI by necessity); the same vars are declared in env.ts for
 * .env.example coherence.
 *
 * Scrubbing (ADR 0040): cookies/auth headers always dropped; any object key
 * matching the PII registry (or the usual secret names) is masked. The
 * registry import is side-effectful — loading the schema populates it.
 * `piiBodyKeys()` carries both the snake_case and camelCase form so a
 * multi-word column (`ip_address`/`ipAddress`) is matched whichever the event
 * key uses — a snake-only set silently misses the camelCase Drizzle/body key.
 *
 * Request-PII scrub (ADR 1009, ports anyora ADR 0070): the key-scrub above
 * cannot reach values Sentry's default integrations splice into strings, so
 * `beforeSend` is the single terminal guarantee for five more surfaces —
 *   1. `event.request.data` (the raw, unparsed request body blob),
 *   2. the querystring on `event.request.url` (cut via {@link stripQueryString}),
 *   3. `event.request.query_string` (the parsed querystring),
 *   4. the `referer`/`referrer` request headers (origin URL incl. querystring),
 *   5. each `event.breadcrumbs[].data` — `http.query`/`http.fragment` and the
 *      querystring on `data.url` (outgoing-request breadcrumbs, e.g. the PostHog
 *      purge's `?distinct_id=<userId>`).
 * `beforeSend` is the last step before transport, so these fields are buffered
 * transiently by the integrations but never leave the process.
 */
import * as Sentry from "@sentry/node";

import { piiBodyKeys } from "@repo/db/pii";

import "@repo/db/schema";

import { stripQueryString } from "../common/logging/redaction.js";

const SECRET_KEYS = new Set(["password", "token", "secret", "authorization", "cookie", "apikey"]);

export function initSentry(): boolean {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return false;

  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "development",
    ...(process.env.SENTRY_RELEASE ? { release: process.env.SENTRY_RELEASE } : {}),
    sendDefaultPii: false,
    // We run our own NodeSDK (otel/register.ts) — Sentry must not set up a second one.
    skipOpenTelemetrySetup: true,
    tracesSampleRate: 0,
    beforeSend: (event) => scrubEvent(event),
  });
  return true;
}

export function scrubEvent<T extends Sentry.ErrorEvent>(event: T): T {
  if (event.request) {
    delete event.request.cookies;
    // Sentry's default httpIntegration buffers the raw request BODY into
    // `event.request.data` as an UNPARSED string — the key-scrub below cannot
    // reach a raw blob, so drop it wholesale. (@sentry/node-core DOES now expose
    // `maxRequestBodySize: "none"` on `httpServerIntegration`, but capture is on
    // by default at `"medium"`, and the option has to be set on whichever
    // integration instance the SDK actually constructs — a terminal scrub in
    // `beforeSend` is the guarantee that does not depend on getting that wiring
    // right, so it stays as the single robust one. See ADR 1009; the shared
    // `@repo/telemetry` scrubber now drops the same field, ADR 1017.)
    delete event.request.data;
    // The URL + querystring are attached by requestDataIntegration independent
    // of the pino serializer — a `?q=<email>` search would otherwise reach
    // Sentry verbatim. Cut the querystring off the URL (single-source reuse of
    // the pino definition) and drop the parsed querystring.
    if (typeof event.request.url === "string") {
      event.request.url = stripQueryString(event.request.url);
    }
    delete event.request.query_string;
    if (event.request.headers) {
      // `referer`/`referrer` carry the origin page's full URL incl. querystring —
      // on the same-origin proxy that is e.g. `/clients?search=<email>`, as
      // PII-bearing as the request URL itself and copied verbatim by
      // requestDataIntegration.
      for (const header of ["cookie", "authorization", "set-cookie", "referer", "referrer"]) {
        delete event.request.headers[header];
      }
    }
  }
  // Outgoing-request breadcrumbs (default `Http` + `NodeFetch` integrations) put
  // the raw querystring in `data["http.query"]` — e.g. the PostHog purge's
  // `?distinct_id=<userId>`. `data.url` is Sentry-sanitised, the query field is
  // not; scrubEvent otherwise never inspects `event.breadcrumbs`.
  if (Array.isArray(event.breadcrumbs)) {
    for (const crumb of event.breadcrumbs) {
      const data = crumb.data as Record<string, unknown> | undefined;
      if (!data) continue;
      delete data["http.query"];
      delete data["http.fragment"];
      if (typeof data.url === "string") data.url = stripQueryString(data.url);
    }
  }
  const piiKeys = new Set(piiBodyKeys().map((k) => k.toLowerCase()));
  scrubObject(event.extra, piiKeys);
  if (event.contexts) {
    for (const context of Object.values(event.contexts)) scrubObject(context, piiKeys);
  }
  return event;
}

function scrubObject(value: unknown, piiKeys: ReadonlySet<string>, depth = 0): void {
  if (depth > 4 || typeof value !== "object" || value === null) return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const lower = key.toLowerCase();
    if (piiKeys.has(lower) || SECRET_KEYS.has(lower)) {
      (value as Record<string, unknown>)[key] = "[scrubbed]";
    } else {
      scrubObject(child, piiKeys, depth + 1);
    }
  }
}
