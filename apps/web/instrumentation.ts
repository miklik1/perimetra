import * as Sentry from "@sentry/nextjs";

import { env } from "@repo/config/env/web";
import { buildSentryOptions } from "@repo/telemetry/web";

import { bootTelemetry } from "./lib/telemetry-boot";

/**
 * Server-side Sentry init + telemetry/flags boot (ADR 0021/0028): Next runs
 * `register()` once per server runtime at boot — before any request — so the
 * globalThis carriers (telemetry registry, logger sink, server flags) are
 * populated for every module graph in this runtime. `@sentry/nextjs` resolves
 * the right build (node/edge) via its package exports, so one init covers
 * both. No DSN ⇒ no init — telemetry stays the silent no-op (dev/test
 * default). The PII scrubber rides in via `buildSentryOptions`
 * (`beforeSend`/`beforeBreadcrumb`).
 *
 * Server flags boot only in the NODE runtime (dynamic import keeps
 * posthog-node out of the edge bundle — `proxy.ts` runs on edge and doesn't
 * evaluate flags; RSC rendering is node). Server analytics stays the no-op —
 * product analytics is a client concern (the PostHog adapter rides the
 * browser boot in `instrumentation-client.ts`).
 */
export async function register(): Promise<void> {
  if (env.NEXT_PUBLIC_SENTRY_DSN) {
    Sentry.init(
      buildSentryOptions({
        dsn: env.NEXT_PUBLIC_SENTRY_DSN,
        environment: env.NEXT_PUBLIC_SENTRY_ENVIRONMENT,
        tracesSampleRate: env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE,
        // SDK debug logging only when a DSN is deliberately set in dev — the
        // wiring-verification case; normal dev has no DSN, production stays
        // quiet. Same mechanism as the client init (Next provides NODE_ENV
        // in both bundles).
        debug: process.env.NODE_ENV === "development",
      }),
    );
  }
  bootTelemetry();
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { bootServerFlags } = await import("./lib/server-flags");
    bootServerFlags();
  }
}

/** Captures RSC/route-handler render errors (Next `onRequestError` hook). */
export const onRequestError = Sentry.captureRequestError;
