import type { Analytics, CaptureAdapter, Telemetry } from "./types";

/**
 * Safe defaults (ADR 0021): with no DSN/adapter configured — dev, tests, SSR
 * before boot, a fork that strips Sentry — every telemetry call is a silent
 * no-op and `startSpan` still runs its function. Zero config ⇒ zero behavior.
 */

export const noopAnalytics: Analytics = {
  trackEvent: () => undefined,
  screen: () => undefined,
  identify: () => undefined,
  reset: () => undefined,
};

export const noopCaptureAdapter: CaptureAdapter = {
  captureException: () => undefined,
  captureMessage: () => undefined,
  addBreadcrumb: () => undefined,
  setUser: () => undefined,
  startSpan: (_name, fn) => fn(),
  flush: () => Promise.resolve(true),
};

export const noopTelemetry: Telemetry = { ...noopCaptureAdapter, analytics: noopAnalytics };
