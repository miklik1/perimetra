/**
 * The vendor-agnostic telemetry contract (ADR 0021). Everything in the apps
 * depends on these interfaces, never on a Sentry SDK — swappable, fakeable in
 * tests, SSR/tree-shake-safe. The per-platform Sentry bindings (`./web`,
 * `./native`) implement `CaptureAdapter`; `createTelemetry` composes one with
 * an `Analytics` into the `Telemetry` facade.
 */

/** Severity for messages and breadcrumbs (a subset of Sentry's levels). */
export type TelemetryLevel = "info" | "warning" | "error";

export interface Breadcrumb {
  message: string;
  /** Grouping hint, e.g. `"log"`, `"navigation"`. */
  category?: string;
  level?: TelemetryLevel;
  data?: Record<string, unknown>;
}

export interface TelemetryUser {
  id: string;
  email?: string;
  username?: string;
}

/**
 * Product analytics seam — vendor-agnostic with a no-op default. The concrete
 * adapter is PostHog (ADR 0028): `createPosthogAnalytics` wraps the ONE
 * PostHog client the app boots for `@repo/flags`; without a key the no-op
 * stands in.
 */
export interface Analytics {
  trackEvent(name: string, props?: Record<string, unknown>): void;
  screen(name: string, props?: Record<string, unknown>): void;
  identify(user: TelemetryUser): void;
  reset(): void;
}

/**
 * What a platform binding implements over its SDK — the single declaration of
 * the capture method list. `Telemetry` is this plus `analytics`, so adding a
 * capture method touches exactly one interface.
 */
export interface CaptureAdapter {
  captureException(error: unknown, context?: Record<string, unknown>): void;
  captureMessage(message: string, level: TelemetryLevel, context?: Record<string, unknown>): void;
  addBreadcrumb(breadcrumb: Breadcrumb): void;
  setUser(user: TelemetryUser | null): void;
  /** Run `fn` inside a span (perf tracing). The no-op just runs `fn`. */
  startSpan<T>(name: string, fn: () => T): T;
  /** Drain pending events (before process exit / page hide). */
  flush(timeoutMs?: number): Promise<boolean>;
}

/**
 * The app-facing facade: a `CaptureAdapter` plus the analytics seam. Resolve
 * via `getTelemetry()` or inject explicitly.
 */
export type Telemetry = CaptureAdapter & { readonly analytics: Analytics };
