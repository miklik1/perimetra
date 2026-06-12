import {
  configureTelemetry,
  createLogSink,
  createPosthogAnalytics,
  createTelemetry,
  noopCaptureAdapter,
} from "@repo/telemetry";
import { setLoggerSink } from "@repo/utils";

import { posthog } from "./posthog";

/**
 * Mobile telemetry boot (ADR 0021/0028) — the native mirror of web's
 * `lib/telemetry-boot.ts`, called once at module scope from `app/_layout.tsx`.
 * RN has no instrumentation files, but the same shape holds: register the
 * vendor-agnostic logger sink so all `@repo/utils` logs (and `@repo/api`
 * request logs) route through the telemetry facade, resolved per capture.
 *
 * LIVE analytics (no longer fully deferred): when a PostHog key is configured,
 * the SHARED `posthog-react-native` client (the same instance `lib/flags.ts`
 * wires into `@repo/flags`) backs the telemetry `analytics` adapter via the
 * SDK-free `createPosthogAnalytics` — one client, one `identify`, two seams,
 * exactly as on web. The auth→identify/reset bridge is
 * `components/analytics-identity.tsx`.
 *
 * DEFERRED: native CAPTURE (errors/perf) stays the no-op — `@sentry/react-native`
 * is not installed and there is no `Sentry.init`, so `capture` is
 * `noopCaptureAdapter`. The two vendors are independently optional (mirrors web,
 * where a PostHog key with no Sentry DSN yields analytics-only). When the native
 * Sentry seam is wired, swap `noopCaptureAdapter` for `createSentryNativeAdapter()`.
 * The sink registers unconditionally. Idempotent — `configureTelemetry` is
 * first-wins and re-registering the sink is harmless.
 */
export function bootTelemetry(): void {
  if (posthog) {
    configureTelemetry(
      createTelemetry({
        capture: noopCaptureAdapter,
        analytics: createPosthogAnalytics(posthog),
      }),
    );
  }
  setLoggerSink(createLogSink());
}
