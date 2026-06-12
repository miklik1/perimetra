import { env } from "@repo/config/env/web";
import {
  configureTelemetry,
  createLogSink,
  createTelemetry,
  noopCaptureAdapter,
  type Analytics,
} from "@repo/telemetry";
import { createSentryWebAdapter } from "@repo/telemetry/web";
import { setLoggerSink } from "@repo/utils";

/**
 * Telemetry boot (ADR 0021) — called once per JS RUNTIME from the
 * instrumentation files: `instrumentation.ts` (`register()`, each server
 * runtime) and `instrumentation-client.ts` (the browser). The telemetry
 * registry and the logger sink live on `globalThis` carriers, so one boot
 * covers every separately-bundled module graph in that runtime (RSC, SSR,
 * route handlers) — no per-graph calls in layouts/providers. Idempotent:
 * `configureTelemetry` is first-wins and re-registering the sink is harmless,
 * so HMR re-runs are no-ops.
 *
 * With a DSN, the facade composes the Sentry web adapter (`Sentry.init` itself
 * runs in the same instrumentation files). The browser boot additionally
 * passes the PostHog analytics adapter (ADR 0028) — a parameter, not an
 * import, because posthog-js is browser-only and this module also boots the
 * server runtimes (server analytics stays the no-op; product analytics is a
 * client concern). With neither signal, `getTelemetry()` stays the silent
 * no-op. The sink registers unconditionally and resolves the facade per
 * capture, routing app + `@repo/api` logs with no code changes on their side.
 */
export function bootTelemetry(analytics?: Analytics): void {
  if (env.NEXT_PUBLIC_SENTRY_DSN || analytics) {
    configureTelemetry(
      createTelemetry({
        // No DSN but a PostHog key ⇒ capture stays the no-op while analytics
        // flows — the two vendors are independently optional.
        capture: env.NEXT_PUBLIC_SENTRY_DSN ? createSentryWebAdapter() : noopCaptureAdapter,
        analytics,
      }),
    );
  }
  setLoggerSink(createLogSink());
}
