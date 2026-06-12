/**
 * Neutral barrel for `@repo/telemetry` (ADR 0021) — the vendor-agnostic
 * contract, the no-op defaults, the composition root, the logger-sink bridge
 * and the PII scrubber. NO `@sentry/*` import on this path: apps and tests can
 * depend on it without pulling an SDK; the bindings live behind
 * `@repo/telemetry/web` and `@repo/telemetry/native`.
 */
export type {
  Telemetry,
  Analytics,
  CaptureAdapter,
  TelemetryUser,
  TelemetryLevel,
  Breadcrumb,
} from "./types";

export { noopTelemetry, noopAnalytics, noopCaptureAdapter } from "./no-op";

export { createTelemetry, type CreateTelemetryOptions } from "./create-telemetry";

export { configureTelemetry, getTelemetry, resetTelemetry } from "./registry";

export { createLogSink } from "./sink";

export { scrubEvent, scrubBreadcrumb, redactString } from "./scrub";

// SDK-free (the scrub hooks are generic) — shared by both platform bindings.
export { buildSentryOptions, type SentryInitConfig } from "./sentry-options";

// SDK-free (structural client type) — wraps the PostHog client the app boots
// for @repo/flags (ADR 0028): one shared instance, two seams.
export { createPosthogAnalytics, type PosthogAnalyticsClient } from "./posthog-analytics";
