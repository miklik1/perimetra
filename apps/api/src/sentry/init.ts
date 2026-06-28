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
 */
import * as Sentry from "@sentry/node";

import { piiBodyKeys } from "@repo/db/pii";

import "@repo/db/schema";

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
    if (event.request.headers) {
      for (const header of ["cookie", "authorization", "set-cookie"]) {
        delete event.request.headers[header];
      }
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
