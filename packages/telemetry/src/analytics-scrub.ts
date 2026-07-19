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
// chain. With no `\"` anywhere, every `"` IS a real delimiter — which is the
// overwhelmingly common case, so ordinary chains keep their element detail. When
// a `\"` IS present the chain cannot be parsed safely, so it is dropped rather
// than half-scrubbed. Losing one autocapture chain beats shipping a token.
//
// "Every `"` is a real delimiter" does NOT license matching `href="` wherever it
// appears (ADR 1018, correcting ADR 1013). The earlier rule was a global
// `/((?:attr__)?href=")([^"]*)(")/gi`, which infers the value's START from the
// literal bytes `href="` — and those bytes are plantable inside any serialized
// attribute value that ENDS with `href=`, needing no quote and therefore
// producing no `\"` to detect. posthog-js folds the clicked element's `text` into
// the chain and sorts attributes with `localeCompare`, which puts `text` LAST,
// immediately before the ancestor's `attr__href`; a link label reading "Paste the
// value after href=" therefore opens a bogus match whose closing group IS the
// real href's opening quote. `lastIndex` lands past it and the real value is
// never scrubbed. That is precisely the defect class ADR 1015 generalised and
// declared closed — the fix had moved the inference from the value's END to its
// START and left it just as plantable.
//
// So the extent is no longer inferred at all. Under the no-`\"` precondition the
// chain's quotes ALTERNATE exactly: splitting on `"` yields structure at even
// indices and values at odd ones. An odd segment is an href value iff the
// structure segment before it ends in an href attribute name — a position no
// value can occupy, because values are odd segments by construction.
//
// Rejoining on `"` is byte-exact, so nothing OUTSIDE an identified href value is
// altered: structure (even-index) segments are never touched, and an odd segment
// is rewritten only behind `CHAIN_HREF_NAME_TAIL`. That is the narrow claim the
// argument needs. It is NOT the stronger claim that a malformed or
// odd-quote-count chain "round-trips unchanged", which is FALSE: on an odd quote
// count the trailing segment is unterminated, yet it is still indexed as a value
// and still passed through `dropUrlQuery`, so `a:attr__href="/p?q=1` returns
// `a:attr__href="/p`. That behaviour is correct (the no-`\"` precondition
// guarantees a real delimiter opened it, so it IS a truncated href value —
// scrubbing it is the intended over-redaction, and the realistic producer is
// posthog-js truncating a long chain mid-value). A test pins the odd-quote case
// so the claim stays backed.
const CHAIN_HAS_AMBIGUOUS_ESCAPE = /\\"/;
// Whether the chain contains an href AT ALL. An href always serializes as
// `href="` + value + `"`, and `attr__href="` contains that same byte sequence, so
// the ABSENCE of these bytes PROVES there is no href value anywhere — the one
// conclusion that stays sound on a chain too ambiguous to parse. It gates the
// drop: without an href the only mutation this scrub performs is provably a
// no-op, so dropping would destroy the whole element tree for zero redaction
// gain. A quote in captured text or an `aria-label` (`Smazat \"Faktura 42\"` —
// ordinary in Czech UI copy) makes a chain ambiguous, and most autocapture events
// are clicks on buttons and divs that carry no href. The test is a regex, not
// `String.includes`, so it is case-insensitive — `HREF="` is reachable, but NOT
// via HTML parsing: the tokenizer's attribute-name state lowercases ASCII
// upper-alpha unconditionally, and it is not context-sensitive to foreign
// content. The tree builder's adjust-SVG-attributes step then restores camelCase
// for a FIXED table only (`viewBox`, `baseFrequency`, `attributeName`, …) — which
// is itself proof the tokenizer lowercased first, since it must repair `viewbox`
// back to `viewBox`. Bare `href` has no entry in that table (only `xlink:href`,
// handled by adjust-foreign-attributes), so `<svg><a HREF="x">` parses to `href`.
//
// The genuinely reachable routes are `setAttribute` and XHTML:
// `document.createElementNS(SVG_NS, "a").setAttribute("HREF", …)` PRESERVES the
// case, because `setAttribute` lowercases only for HTML-namespace elements in
// HTML documents; and markup served as `application/xhtml+xml` is XML-parsed,
// which preserves it too. posthog-js keys the chain off the raw attribute name
// (`props["attr__" + attr.name]`) with no case normalisation, so `attr__HREF` is
// producible either way. `/i` only ever widens the redaction gate.
const CHAIN_HAS_HREF = /href="/i;
// An href attribute NAME at the very END of a structure segment, i.e. the name
// whose value the next quote opens. The leading non-name character is what keeps
// `attr__data-xhref=` from being read as an href; `attr__` is spelled out rather
// than allowed by that class so the prefix is matched, not merely tolerated.
//
// The boundary class excludes only `a-z0-9_-`, so `:` and `.` DO satisfy it and
// any attribute whose name ends in `:href` or `.href` is read as an href. Both
// directions are deliberate and both are pinned by tests:
//   - WANTED: `xlink:href` (React renders `xlinkHref` to exactly that) is a real
//     link attribute and must be scrubbed.
//   - ACCEPTED COST: framework binding syntaxes that survive into the live DOM —
//     Alpine's `x-bind:href` and its `:href` shorthand — are captured by
//     autocapture with the raw JS EXPRESSION as the value, and `dropUrlQuery`
//     then cuts at the first `[?#]`, which in an expression is the TERNARY
//     operator (`isAdmin ? a : b` → `isAdmin `). That is over-redaction of
//     autocapture detail, never a leak, and this repo does not ship Alpine.
//     Narrowing the class to exclude `:` would drop `xlink:href` coverage —
//     trading a real leak for a cosmetic one, the wrong direction for this
//     module.
// Not a regression from the ADR 1013 rule: the superseded global
// `/((?:attr__)?href=")([^"]*)(")/gi` matched `href="` wherever it appeared and
// so admitted these same names identically.
const CHAIN_HREF_NAME_TAIL = /(?:^|[^a-z0-9_-])(?:attr__)?href=$/i;

// The grammar check that makes quote-parity SOUND rather than merely assumed
// (ADR 1020). The no-`\"` precondition proves nothing on its own: it only rules
// out quotes the ESCAPER produced, and posthog-js does not escape every field it
// concatenates. `escapeQuotes` is applied to attribute keys and values
// (autocapture-utils.js:603) and quotes are stripped from class names (:582), but
// `element.tag_name` is concatenated RAW (:574-575) from
// `elem.tagName.toLowerCase()`. Per the HTML tokenizer's tag-name state a `"` is
// an "anything else" code point and is APPENDED to the tag name, so `<span"x>`
// parses to localName `span"x` — injecting a bare quote with NO backslash. That
// shifts the split parity by one: every href value lands at an EVEN index, is
// read as a structure segment, and is never scrubbed. The chain then passes
// through BYTE-IDENTICAL — total redaction failure, not partial.
//
// An odd-quote-COUNT test does not fix it (verified): two injected tag-name
// quotes restore an even count while still shifting parity for the first href.
// So check the grammar the parity argument actually assumes instead. In a
// well-formed chain every even-index segment except the last is a run of
// `…name=` text ending at the quote that opens the next value, so it MUST end in
// `=`. A segment that does not is proof the parity has slipped, and the chain is
// handed to the same ambiguous-case policy as a `\"` chain: dropped if it carries
// an href, kept otherwise.
//
// This preserves every deliberate behaviour above — the planted-`href=` label
// (its even segments all still end in `=`), the truncated odd-quote chain, the
// href-less and structure-only chains — while closing the injection. It is the
// SAME defect class as skeleton ADR 1015 and ADR 1018 above, arriving a third
// time: an argument about local structure defeated by planting that structure.
// The lesson is now explicit — a precondition about who ESCAPED a byte is only
// as strong as the weakest field the producer concatenates unescaped.
const CHAIN_STRUCTURE_SEGMENT_TAIL = /=$/;

function scrubElementsChain(chain: string): string {
  if (CHAIN_HAS_AMBIGUOUS_ESCAPE.test(chain)) return CHAIN_HAS_HREF.test(chain) ? REDACTED : chain;
  const parts = chain.split('"');
  // Parity must be VERIFIED, not assumed — see CHAIN_STRUCTURE_SEGMENT_TAIL.
  for (let i = 0; i < parts.length - 1; i += 2)
    if (!CHAIN_STRUCTURE_SEGMENT_TAIL.test(parts[i] as string))
      return CHAIN_HAS_HREF.test(chain) ? REDACTED : chain;
  for (let i = 1; i < parts.length; i += 2) {
    if (CHAIN_HREF_NAME_TAIL.test(parts[i - 1] as string))
      parts[i] = dropUrlQuery(parts[i] as string);
  }
  return parts.join('"');
}

function scrubEntry(key: string, value: unknown): unknown {
  if (typeof value === "string") {
    if (key === "$elements_chain") return scrubElementsChain(value);
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
  // An array element inherits its PROPERTY's key, so a URL-named key still
  // reaches the URL branch. Passing "" here (the previous behaviour) was
  // invisible for an array of OBJECTS — `$elements`, where the object branch
  // below restores real keys — but silently disarmed the key-gated branches for
  // an array of STRINGS: a `href: ["/clients?search=Novakova"]` fell through to
  // `stripEmbeddedUrlQueries`, which needs a `://` or a dotted `//host`, so a
  // RELATIVE href kept its query while the byte-identical scalar was stripped.
  // This is the sink that runs no value-shape pass at all, so nothing else
  // catches it, and the Sentry walk cannot cover for it either — `URL_KEYS`
  // deliberately excludes `href`/`$current_url`, which are this module's names.
  // Carrying the key through an array is what `./scrub`'s `scrubUrlValue` already
  // does for the Sentry side ("the scalar, an array of URLs, and (defensively) a
  // nested object").
  //
  // Reachability, stated narrowly: `posthog-js` autocapture never emits an array
  // of strings under a URL-named key (`$current_url`/`$referrer` are scalars,
  // `$elements` is objects), so this is not a default-path leak — it goes live the
  // moment app code writes `trackEvent(…, { href: [...] })`. Fixed rather than
  // deferred because the surprise is total: the identical scalar IS stripped, so
  // an author has no signal the array form is not.
  if (Array.isArray(value)) return value.map((item) => scrubEntry(key, item));
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
