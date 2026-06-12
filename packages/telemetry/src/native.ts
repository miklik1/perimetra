import * as Sentry from "@sentry/react-native";

import type { Breadcrumb, CaptureAdapter } from "./types";

// Native binding (ADR 0021): `CaptureAdapter` over `@sentry/react-native`,
// the mirror of `./web`. SEAM ONLY today — the dormant mobile app does not
// `Sentry.init` or install the native module; wiring is gated with the other
// mobile work (EAS build validation). Built now so the contract is proven on
// both platforms and the wiring is a boot-file change, not a design change.
// The shared `buildSentryOptions` (scrubber pre-wired) comes via the neutral
// re-export below — spread it into `Sentry.init` in the mobile boot file.
export * from "./index";

/**
 * `CaptureAdapter` over the `@sentry/react-native` global. Safe to construct
 * without an init/DSN (SDK calls no-op), same as the web adapter.
 */
export function createSentryNativeAdapter(): CaptureAdapter {
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
    // The RN SDK's flush takes no timeout — it drains the native queue. The
    // contract's timeoutMs is accepted and intentionally unused here.
    flush: () => Sentry.flush(),
  };
}
