/**
 * PostHog analytics property scrubber (ADR 1011, extended by ADR 1013) — the
 * analytics-sink mirror of the Sentry URL-query scrub in `./scrub`.
 *
 * WHY a second sink. The Sentry scrubber runs on Sentry events; the analytics
 * adapter (`./posthog-analytics`) runs `scrubEvent` on the properties of events
 * the app captures EXPLICITLY (`trackEvent`/`screen`). But PostHog's browser SDK
 * ALSO autocaptures `$pageview` / `$pageleave` / `$autocapture` internally, and
 * attaches the full page + referrer URL — WITH the `?query` — as `$current_url`
 * / `$referrer` (and, as person properties, `$initial_current_url` /
 * `$initial_referrer`). Those events never pass through the adapter, so an
 * arbitrary `?search=<surname>` — PII no value-shape pattern recognises — ships
 * in the clear. This runs at the SDK's own `before_send` hook (wired in
 * `@repo/flags`' `posthog.init`, injected from the app root — the DAG forbids
 * `flags → telemetry`), so it covers autocaptured events too.
 *
 * DELIBERATELY NARROW — URL query stripping ONLY, not the full Sentry-style PII
 * walk:
 *   - `identify` ships id + email + username as person properties by design (an
 *     audited payload, see `./posthog-analytics`). A blind key/shape redaction
 *     would `[Filtered]` that intended email.
 *   - PostHog structural props are ids/timestamps (`$device_id`, `$time`, …); a
 *     blind value-shape walk could rewrite an all-digit id via the rodné-číslo
 *     pattern (the same hazard `scrubSpan` avoids by staying targeted).
 * So: URL-bearing keys keep origin+path and drop the query; any OTHER string has
 * only its embedded-URL queries stripped (never its value shapes) — leaving the
 * email/username person payload and every numeric id exactly as PostHog needs.
 */

import { dropUrlQuery, REDACTED, stripEmbeddedUrlQueries } from "./scrub";

// PostHog property NAMES whose value is a URL (absolute or a relative href):
// the page + referrer URLs on every autocaptured event, their `$initial_*`
// person-property forms, an autocaptured external-link click, and element
// `href` / `attr__href` attributes (autocapture `$elements`). Keep origin+path,
// drop the query/fragment. `search`/`query`-style keys are intentionally NOT
// here: PostHog does not attach a raw query bag, and the Sentry key policy owns
// those names.
const ANALYTICS_URL_KEY =
  /^(\$current_url|\$referrer|\$initial_current_url|\$initial_referrer|\$external_click_url|(attr__)?href)$/i;

// `$elements_chain` — the serialized autocapture element tree, attached to EVERY
// `$autocapture` event (unconditionally, alongside `$elements`; it is the field
// PostHog's ingestion actually reads). It is one whitespace-free string of the
// form `a.btn:attr__href="/x?q=1"nth-child="2";div:nth-child="1"`, so it is
// neither a URL key nor ordinary free text: the generic pass cannot find a
// relative href (no `://`) and would run its tail past the closing quote of an
// absolute one, shredding every following attribute and ancestor. Scrub the
// quoted href values in place instead — surgical, and the chain stays parseable.
//
// FINDING THE VALUE'S END is only sometimes possible, so this scrub DETECTS the
// ambiguous case instead of trying to parse through it. posthog-js escapes a
// literal `"` as `\"` but never escapes a backslash (`e.replace(/"|\\"/g,
// '\\"')`), so the encoding is LOSSY: a `\"` is ambiguous between "escaped quote
// mid-value" and "value ending in a literal backslash, then the real delimiter".
// Three parsing strategies were tried and all three leaked under an adversarial
// pass — `[^"]*` strands the rest of an escaped-quote value as raw text;
// honouring `\"` runs past the real delimiter and swallows the NEXT href's token
// whole; and anchoring on the chain grammar just moves the tell, since a value
// can contain a quote followed by grammar-shaped text. Whoever controls an href
// controls the bytes the heuristic reads, so no local rule is sound.
//
// But the ambiguity has a single, reliable tell: it requires a `\"` in the
// chain. With no `\"` anywhere, every `"` IS a real delimiter and `[^"]*` is
// exactly correct — which is the overwhelmingly common case, so ordinary chains
// keep their element detail. When a `\"` IS present the chain cannot be parsed
// safely, so the whole property is dropped rather than half-scrubbed. Losing one
// autocapture chain beats shipping a token.
const CHAIN_HAS_AMBIGUOUS_ESCAPE = /\\"/;
const ELEMENTS_CHAIN_HREF = /((?:attr__)?href=")([^"]*)(")/gi;

function scrubEntry(key: string, value: unknown): unknown {
  if (typeof value === "string") {
    if (key === "$elements_chain")
      return CHAIN_HAS_AMBIGUOUS_ESCAPE.test(value)
        ? REDACTED
        : value.replace(
            ELEMENTS_CHAIN_HREF,
            (_match, prefix: string, url: string, suffix: string) =>
              `${prefix}${dropUrlQuery(url)}${suffix}`,
          );
    // A whole-value URL under a URL-named key. NOT gated on url-SHAPE: a key
    // like `attr__href` means the value IS a URL, including a bare relative one
    // ("products?q=1", "?page=2") that no shape test recognises. `dropUrlQuery`
    // is a no-op on a value with no `?`/`#`, so a non-URL sentinel ("$direct")
    // passes through untouched.
    if (ANALYTICS_URL_KEY.test(key)) return dropUrlQuery(value);
    // Any other free-text prop ($el_text, a custom string): cut the query of a
    // URL sitting inside it, but leave value shapes (emails/tokens) intact so the
    // deliberate identify person payload is never redacted.
    return stripEmbeddedUrlQueries(value);
  }
  if (Array.isArray(value)) return value.map((item) => scrubEntry("", item));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrubEntry(k, v)]));
  }
  // Numbers, booleans, null — ids, timestamps, counts: untouched.
  return value;
}

/**
 * Scrub a PostHog event's property bag (a `properties` / `$set` / `$set_once`
 * object) — returns a scrubbed copy. Pure; SDK-free (the caller in `@repo/flags`
 * adapts it into a `before_send` over `CaptureResult`).
 */
export function sanitizeAnalyticsProperties(
  properties: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(properties).map(([key, value]) => [key, scrubEntry(key, value)]),
  );
}
