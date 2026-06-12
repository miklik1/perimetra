import { noopAnalytics } from "./no-op";
import type { Analytics, CaptureAdapter, Telemetry } from "./types";

export interface CreateTelemetryOptions {
  /** Platform capture binding (`createSentryWebAdapter()` / native / a fake). */
  capture: CaptureAdapter;
  /** Product-analytics adapter; defaults to the no-op (PostHog lands with @repo/flags, ADR 0028). */
  analytics?: Analytics;
}

/**
 * Compose a `CaptureAdapter` + `Analytics` into the `Telemetry` facade —
 * the only place the two halves meet (ADR 0021 "refined-A"). Pure: no module
 * state; pass the result to `configureTelemetry` at boot, or hold it locally
 * in tests.
 */
export function createTelemetry({
  capture,
  analytics = noopAnalytics,
}: CreateTelemetryOptions): Telemetry {
  return { ...capture, analytics };
}
