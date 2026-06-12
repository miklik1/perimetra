import * as Sentry from "@sentry/nextjs";

import type { Breadcrumb, CaptureAdapter } from "./types";

// Web binding (ADR 0021): a thin `CaptureAdapter` over the `@sentry/nextjs`
// process-global. Re-exports the neutral contract — including the shared
// `buildSentryOptions` builder the app's instrumentation files spread into
// `Sentry.init` — so the app pulls everything telemetry from this one entry,
// the mirror of `./native`.
export * from "./index";

/**
 * `CaptureAdapter` over the already-initialized `@sentry/nextjs` global
 * (`Sentry.init` runs in the app's instrumentation files, NOT here). Without
 * an init/DSN the SDK's calls are themselves no-ops, so this adapter is safe
 * to construct unconditionally.
 */
export function createSentryWebAdapter(): CaptureAdapter {
  return {
    captureException: (error, context) => {
      Sentry.captureException(error, context ? { extra: context } : undefined);
    },
    captureMessage: (message, level, context) => {
      Sentry.captureMessage(message, { level, extra: context });
    },
    addBreadcrumb: (breadcrumb: Breadcrumb) => {
      Sentry.addBreadcrumb(breadcrumb);
    },
    setUser: (user) => {
      Sentry.setUser(user);
    },
    startSpan: (name, fn) => Sentry.startSpan({ name }, fn),
    flush: (timeoutMs) => Sentry.flush(timeoutMs),
  };
}
