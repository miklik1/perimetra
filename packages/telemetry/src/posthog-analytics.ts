import { scrubEvent } from "./scrub";
import type { Analytics, TelemetryUser } from "./types";

/**
 * The concrete PostHog `Analytics` adapter (ADR 0028) — SDK-FREE: it types
 * the shared client STRUCTURALLY (the method subset posthog-js and
 * posthog-react-native both expose), so `@repo/telemetry` gains no PostHog
 * dependency. The app passes the ONE PostHog client it boots for
 * `@repo/flags`; this adapter and the flags adapter wrap the same instance —
 * one SDK, one identify, two seams.
 */
export interface PosthogAnalyticsClient {
  capture(event: string, properties?: Record<string, unknown>): unknown;
  identify(distinctId: string, properties?: Record<string, unknown>): unknown;
  reset(): unknown;
}

/**
 * `Analytics` over the shared PostHog client. Notes on the mapping:
 *
 * - `screen` emits PostHog's canonical `$screen` event (what the RN SDK
 *   sends), NOT a synthetic `$pageview` — faking pageviews would corrupt web
 *   pageview analytics once autocapture is consented on.
 * - `identify` ships id + email + username as person properties (confirmed
 *   scope). PII NOTE: the Sentry scrubber (ADR 0021) does NOT cover PostHog —
 *   these three fields are the deliberate, audited person payload; extend
 *   only knowingly.
 * - Pre-init/pre-consent calls are the SDK's concern: posthog-js no-ops
 *   capture while opted out, and the app only composes this adapter when a
 *   PostHog key exists.
 */
export function createPosthogAnalytics(client: PosthogAnalyticsClient): Analytics {
  return {
    trackEvent: (name, props) => {
      client.capture(name, scrubEvent(props));
    },
    screen: (name, props) => {
      client.capture("$screen", scrubEvent({ $screen_name: name, ...props }));
    },
    identify: (user: TelemetryUser) => {
      client.identify(user.id, { email: user.email, username: user.username });
    },
    reset: () => {
      client.reset();
    },
  };
}
