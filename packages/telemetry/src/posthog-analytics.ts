import { sanitizeAnalyticsProperties } from "./analytics-scrub";
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
 * - EXPLICIT captures go through BOTH sinks' vocabularies (ADR 1031). This
 *   adapter used to run `scrubEvent` alone — the SENTRY walk, whose URL key list
 *   deliberately EXCLUDES the analytics names (`href`, `$current_url`,
 *   `ph_keyword`) on the stated grounds that "those are the analytics module's
 *   names". They were nobody's, on this path: a
 *   `trackEvent("row_clicked", { href: "/clients?search=Novakova" })` shipped
 *   the surname, because a RELATIVE href has no `://` for the free-text pass to
 *   find and no Sentry key rule to catch it. The autocaptured twin of the very
 *   same value was reduced correctly by `before_send` in the same session —
 *   the silent asymmetry this lineage keeps producing, here between the
 *   automatic and the explicit sink rather than between two representations.
 *   `sanitizeAnalyticsProperties` runs FIRST (URL-bearing values reduced by the
 *   parser, bare search terms dropped), then `scrubEvent` applies the
 *   sensitive-key and value-shape rules. Mobile gets this for free, which
 *   matters because the installed `posthog-react-native` exposes NO
 *   `before_send` seam at all — this adapter is the only sink there is.
 * - Pre-init/pre-consent calls are the SDK's concern: posthog-js no-ops
 *   capture while opted out, and the app only composes this adapter when a
 *   PostHog key exists.
 */
/**
 * Both vocabularies, in order: the analytics sink's URL/search-term policy, then
 * the Sentry walk's sensitive-key and value-shape policy. Single-homed so the
 * two capture methods below cannot drift apart.
 */
function scrubProperties(props: Record<string, unknown> | undefined) {
  return props === undefined ? props : scrubEvent(sanitizeAnalyticsProperties(props));
}

export function createPosthogAnalytics(client: PosthogAnalyticsClient): Analytics {
  return {
    trackEvent: (name, props) => {
      client.capture(name, scrubProperties(props));
    },
    screen: (name, props) => {
      client.capture("$screen", scrubProperties({ $screen_name: name, ...props }));
    },
    identify: (user: TelemetryUser) => {
      client.identify(user.id, { email: user.email, username: user.username });
    },
    reset: () => {
      client.reset();
    },
  };
}
