/**
 * PostHog analytics property scrubber — ADR 1030.
 *
 * WHY a second sink. The Sentry scrubber runs on Sentry events; the analytics
 * adapter (`./posthog-analytics`) runs `scrubEvent` on the properties of events
 * the app captures EXPLICITLY (`trackEvent`/`screen`). But PostHog's browser SDK
 * ALSO autocaptures `$pageview` / `$pageleave` / `$autocapture` internally and
 * attaches the full page + referrer URL — WITH the `?query` — under several
 * names. Those events never pass through the adapter, so an arbitrary
 * `?search=<surname>` — PII no value-shape pattern recognises — ships in the
 * clear. This runs at the SDK's own `before_send` hook (wired in `@repo/flags`'
 * `posthog.init`, injected from the app root — the DAG forbids
 * `flags → telemetry`).
 *
 * DELIBERATELY NARROW — URL reduction only, not the full Sentry-style PII walk.
 * `identify` ships id + email + username as person properties BY DESIGN (an
 * audited payload, see `./posthog-analytics`), and PostHog's structural props
 * are ids and timestamps, so a blind value-shape walk would `[Filtered]` an
 * intended email and rewrite an all-digit id through the rodné-číslo pattern.
 * So: URL-bearing keys are reduced by the parser or redacted; any OTHER string
 * has only its embedded-URL queries stripped.
 *
 * THIS FILE IS A REPLACEMENT, NOT AN ITERATION. Six adversarial review rounds
 * ran over the previous design; each declared the code correct, each was
 * falsified by the next round's execution, and the full cold gate was green
 * throughout. Every one of those escapes was a value SHAPE outside a model that
 * enumerated the shapes it knew. So the rule is inverted: an unmodelled shape
 * REDACTS. See ADR 1030 for the measurements this design is built on and for the
 * acceptance corpus it must cover by construction; ADR 1031 records the
 * vocabulary and structure repairs the ADR 1030 adversarial review found.
 */

import { REDACTED, safeUrlOrRedact, stripEmbeddedUrlQueries } from "./scrub";

// The URL vocabulary, in THREE tiers, because one flat set was wrong in both
// directions at once (ADR 1031).
//
// Tier 1 — UNAMBIGUOUS URL attribute names. A property called `href` or `src`
// holds a URL wherever it appears, including as an ordinary app event property
// (`capture("link_click", { href: "/x?q=1" })`), so these are matched globally.
const URL_ATTRIBUTE_NAMES = new Set([
  "href",
  "src",
  "srcset",
  "imagesrcset",
  "ping",
  "poster",
  "formaction",
  "manifest",
  "longdesc",
  "lowsrc",
  "dynsrc",
  "codebase",
  "usemap",
  // posthog-js sets `$pathname` on every pageview — this is a first-class
  // PostHog property, not only an attribute name, so it is unambiguous.
  "pathname",
]);

// Tier 2 — names that are URL-bearing ONLY as an HTML attribute. `action`,
// `data`, `cite`, `background` and `profile` are among the most ordinary
// property names an app can choose, and matching them globally silently
// rewrote real analytics data: `{ action: "signup_completed", data: "user
// pressed save", cite: "Nováková, 2026" }` came back as `/signup_completed`,
// `[Filtered]` and `[Filtered]`. That is a redaction rule turned into a
// data-corruption rule — the same failure mode as the `$heatmap_data` merge,
// arriving through the vocabulary instead of through the accumulator.
//
// They keep full coverage where they ARE attributes: inside `$elements_chain`,
// inside `$elements`, and under an explicit `attr__` prefix anywhere.
const ATTRIBUTE_ONLY_URL_NAMES = new Set([
  "action",
  "cite",
  "data",
  "background",
  "profile",
  "archive",
]);

// Tier 3 — names whose value is a bare SEARCH TERM, not a URL. There is no path
// to keep, so they are redacted whole, exactly like the Sentry side's
// query-only keys.
//
// `ph_keyword` is not hypothetical and it is not ours: MEASURED in the installed
// posthog-js, `Us(referrer)` classifies the referring search engine and then
// does `s.ph_keyword = Is(r.referrer, i)` where `i` is `"q"` (or `"p"` for
// Yahoo) — i.e. it lifts the user's SEARCH QUERY out of the referrer and ships
// it as a first-class property. A user who arrived from a Google search for
// "Nováková 800101/1234" sent that string verbatim. It is one key away from the
// `$referrer` this file has always scrubbed, and it was missed because the
// vocabulary asked "is this a URL?" — the answer here is no, which is precisely
// why it leaked.
const REDACT_WHOLE_NAMES = new Set(["ph_keyword"]);

// A NAME SHAPE, not a list of names. `$current_url`, `$initial_current_url`,
// `$external_click_url` and `$session_entry_url` are one rule here rather than
// four entries, and a name a future posthog-js adds is covered without this file
// changing. That is the point: round 6 missed two names because the vocabulary
// was an enumeration, and an enumeration cannot be complete against a producer
// that mints names at runtime.
//
// THE SEPARATOR CLASS IS `[_\-.]`, NOT `_` ALONE (ADR 1031). HTML attribute
// names separate words with a HYPHEN, so the `_`-only form covered `data_href`
// — a name nothing produces — while missing `data-href`, `data-url` and
// `data-src`, which are what `data-*` attributes actually look like and which
// posthog-js serialises verbatim into both `$elements` and the chain. The
// suffix rule existed to stop the vocabulary being an enumeration and was itself
// enumerating one separator.
//
// `src` is in this rule AS WELL AS in tier 1, because the tier-1 set matches a
// whole name and `data-src` is a compound one. A name is URL-bearing whether it
// IS `src` or merely ENDS in it.
const URL_NAME_SUFFIX = /(?:^|[_\-.])(?:url|uri|href|src|referrer|referer)$/i;
// The camelCase spelling of the same rule, tested BEFORE lower-casing because
// lower-casing destroys the only boundary there is: `callbackUrl` and `curl`
// both lower-case to something ending in `url`, and only the capital
// distinguishes a compound name from a word that merely ends in those letters.
const URL_NAME_CAMEL_SUFFIX = /[a-z0-9](?:Url|Uri|Href|Src|Referrer|Referer)$/;

// posthog-js 1.379.2 `getSessionProps()` — MEASURED in the installed bundle,
// `dist/module.js`:
//
//   function I(t){return t.replace(/^\$/,"")}
//   getSessionProps(){var t={};return nr(hr(this.getSetOnceProps()),
//     ((e,i)=>{"$current_url"===i&&(i="url"),t["$session_entry_"+I(i)]=e})),t}
//
// i.e. the family is generated by CONCATENATION from the set-once property set.
// So its members are not enumerated here — the producer's transform is INVERTED,
// and each member inherits the policy of the source key it was derived from.
// `$session_entry_url` and `$session_entry_referrer` get the URL policy;
// `$session_entry_ph_keyword` inherits the REDACT policy its source has;
// `$session_entry_utm_source` keeps the free-text policy its source has and is
// not mangled into `/google`. A member added by a future SDK is covered by
// construction, which is the whole reason this is a transform and not a list.
const SESSION_ENTRY_PREFIX = /^\$session_entry_/i;

// CSS has exactly ONE syntax for embedding a URL, and this is it. Naming the
// PRODUCER rather than the schemes is deliberate: a scheme list here would be
// the enumerate-the-cases shape this lineage keeps being punished for, and it
// would have to re-list `data:`/`mailto:`/`tel:` at a second sink.
const CSS_URL_FUNCTION = /url\(/i;

/**
 * What policy a key's value gets — the ONE classifier, shared by the scalar
 * path, the `$elements` object path and the `$elements_chain` value path. The
 * round-4/round-5 defect was two vocabularies over the same DOM data, and the
 * round-5 defect was one vocabulary consulted through two independently authored
 * boundaries; so there is exactly one function and every path calls it.
 *
 * `inAttributes` says the key came from an ATTRIBUTE position — inside the
 * chain, inside `$elements`, or carrying an explicit `attr__` prefix — which is
 * what unlocks the tier-2 names.
 */
function keyPolicy(key: string, inAttributes: boolean): "redact" | "url" | "style" | "text" {
  if (SESSION_ENTRY_PREFIX.test(key)) {
    const source = key.replace(SESSION_ENTRY_PREFIX, "");
    // `url` is the only renamed member — verified in the installed bundle: the
    // producer's only rename is `"$current_url" === i && (i = "url")`.
    return keyPolicy(source.toLowerCase() === "url" ? "$current_url" : `$${source}`, inAttributes);
  }
  const bare = key.trim().replace(/^\$/, "");
  // NAMESPACE FIRST, then `attr__`. The other order is wrong, and it was caught
  // by execution rather than by reading: the chain's structure segment yields
  // `img:attr__src` (tag and attribute together), and stripping `attr__` from
  // the FRONT of that does nothing, so the namespace split then leaves
  // `attr__src` — which matches no entry, and `attr__src` values fell through to
  // the free-text pass. Splitting the namespace off first reduces
  // `img:attr__src`, `attr__xlink:href`, `xlink:href` and `attr__href` to the
  // same local names the scalar path uses.
  const colon = bare.lastIndexOf(":");
  const afterNamespace = colon !== -1 ? bare.slice(colon + 1) : bare;
  const isAttribute = inAttributes || /^attr__/i.test(afterNamespace);
  const name = afterNamespace.replace(/^attr__/i, "");
  if (name === "") return "text";
  const lower = name.toLowerCase();
  if (REDACT_WHOLE_NAMES.has(lower)) return "redact";
  if (isAttribute && lower === "style") return "style";
  if (URL_ATTRIBUTE_NAMES.has(lower)) return "url";
  if (isAttribute && ATTRIBUTE_ONLY_URL_NAMES.has(lower)) return "url";
  return URL_NAME_SUFFIX.test(name) || URL_NAME_CAMEL_SUFFIX.test(name) ? "url" : "text";
}

/** Apply a classified policy to one string value. */
function scrubString(policy: ReturnType<typeof keyPolicy>, value: string): string {
  switch (policy) {
    case "redact":
      return REDACTED;
    case "url":
      return safeUrlOrRedact(value);
    // An inline `style` is not a URL and must not be handed to the URL
    // primitive wholesale — but it CAN carry one, and a RELATIVE `url()`
    // (`background:url(/avatars/novakova?sig=…)`) is invisible to the free-text
    // pass, which needs a `://` or a dotted `//host`. So: a style declaration
    // containing CSS's url() syntax is redacted whole (there is no safe
    // sub-extent to keep without inferring a boundary, and inline styles are
    // not analytics signal worth that risk); anything else keeps the ordinary
    // free-text treatment.
    case "style":
      return CSS_URL_FUNCTION.test(value) ? REDACTED : stripEmbeddedUrlQueries(value);
    default:
      return stripEmbeddedUrlQueries(value);
  }
}

// ── $elements_chain ────────────────────────────────────────────────────────
//
// The chain is the serialized autocapture element tree, attached to EVERY
// `$autocapture` event and the field PostHog's ingestion actually reads. It
// cannot simply be dropped in favour of the structured `$elements` twin:
// measured in posthog-js 1.379.2, `$elements` is emitted CONDITIONALLY
// (`or({$event_type:n.type,$ce_version:1}, u?{}:{$elements:p}, {$elements_chain:…})`)
// while the chain is unconditional, so dropping it would destroy autocapture
// outright rather than degrade it.
//
// It also cannot be trusted to parse. Measured in the same bundle, its producer
// applies THREE different escaping disciplines in one string: attribute keys and
// values go through `fs(t){return t.replace(/"|\\"/g,'\\"')}` (escaped), class
// names have quotes DELETED (`s.replace(/"/g,"")`), and `tag_name` is
// concatenated RAW (`t.tag_name&&(r+=t.tag_name)`). Six rounds of parse repairs
// were each defeated by planting the structure the repair read.
//
// So the parse stays, but what a parse FAILURE means is inverted: it REDACTS.
// Previously a failure fell back to "keep the chain unless it contains an href",
// which is how a chain kept a payload the `$elements` copy lost in the same call.
const CHAIN_AMBIGUOUS_ESCAPE = /\\"/;
// A well-formed even (structure) segment is a run of `tag.class:name=` text
// ending at the quote that opens the next value, so it MUST end in `=`. One that
// does not is proof the split parity has slipped — the tag-name injection
// (`<span"x>` parses to localName `span"x`) shifts every value to an even index,
// where it would be read as structure and never scrubbed.
const CHAIN_STRUCTURE_TAIL = /=$/;
// A URL payload inside a STRUCTURE segment. Structure segments are tag names,
// class names and attribute names; a payload there is anomalous, and the
// realistic producer is a Tailwind arbitrary value —
// `bg-[url(https://cdn.app.cz/i?sig=…)]`. It cannot be rewritten in place,
// because class names are quote-STRIPPED rather than escaped, so there is no
// delimiter to bound a rewrite against that an author cannot plant. We do not
// infer one. The chain is redacted whole.
//
// THE MARKER SET WAS WRONG IN BOTH DIRECTIONS AT ONCE (ADR 1031), which is why
// it is not just a byte list any more:
//
// - TOO BROAD on `#`. A Tailwind arbitrary COLOUR (`bg-[#0f172a]`) contains a
//   `#`, so the entire `$elements_chain` was redacted for any click anywhere on
//   any page using arbitrary hex colours — i.e. on a typical Tailwind app,
//   autocapture was annihilated wholesale, with no URL and no PII anywhere near
//   the event. Over-redaction is the safe direction only while it stays a
//   trade; at that scale it is a functional break.
// - TOO NARROW on the schemes. `//`, `?` and `#` are the punctuation of a
//   HIERARCHICAL url. `bg-[url(data:text/csv,Novakova;8001011234)]` and
//   `bg-[url(mailto:jana@firma.cz)]` contain none of them, so a structure
//   segment shipped a rodné číslo verbatim — re-opening, inside the structure
//   half, the exact non-hierarchical-scheme leak §3 closed for values.
//
// So the rule now names CSS's URL PRODUCER (`url(`) rather than enumerating the
// schemes a payload might use, and `#` is redacted UNLESS every occurrence is a
// CSS hex colour. That exemption is stated rather than hidden, and it cannot
// help an author hide anything: a `#` followed by anything that is not exactly
// a 3/4/6/8-digit hex colour still redacts the chain.
//
// `@` is deliberately NOT a marker: Tailwind v4 container queries put it in
// ordinary class names (`@md:flex`, `@container`), and userinfo is unreachable
// without an authority, which `//` already catches. Both directions are pinned
// by tests, because this is exactly the kind of narrowing that silently rots.
const CHAIN_STRUCTURE_PAYLOAD = /\/\/|\?|url\(/i;
// A CSS hex colour: `#` + exactly 3, 4, 6 or 8 hex digits, not followed by more
// name characters. Anything else wearing a `#` is not a colour.
const CSS_HEX_COLOR = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{4}|[0-9a-f]{3})(?![0-9a-z])/gi;

function structureCarriesPayload(segment: string): boolean {
  if (CHAIN_STRUCTURE_PAYLOAD.test(segment)) return true;
  // Every `#` that is a hex colour is removed first; a `#` surviving that is a
  // fragment marker, and a fragment in a structure segment is a payload.
  return segment.replace(CSS_HEX_COLOR, "").includes("#");
}
// The attribute name whose value the next quote opens. Captured rather than
// matched against an href-only pattern, so the name goes through the SAME
// `keyPolicy` the scalar and `$elements` paths use.
const CHAIN_ATTRIBUTE_NAME_TAIL = /(?:^|[^a-z0-9_:.-])((?:attr__)?[a-z0-9_:.-]+)=$/i;

function scrubElementsChain(chain: string): string {
  // A `\"` makes the encoding lossy — it is ambiguous between "escaped quote
  // mid-value" and "value ending in a backslash, then the real delimiter" — so
  // the chain cannot be split soundly at all.
  if (CHAIN_AMBIGUOUS_ESCAPE.test(chain)) return REDACTED;

  const parts = chain.split('"');

  // Verify the split BEFORE trusting it, and examine the structure half rather
  // than exempting it. Every even segment is checked, including the last: in a
  // well-formed chain the last even segment is the empty string (the chain ends
  // with a closing quote), and exempting it is where a shifted parity parks a
  // whole URL.
  for (let i = 0; i < parts.length; i += 2) {
    const segment = parts[i] as string;
    const aligned = i === parts.length - 1 ? segment === "" : CHAIN_STRUCTURE_TAIL.test(segment);
    if (!aligned) return REDACTED;
    if (structureCarriesPayload(segment)) return REDACTED;
  }

  // The split is now verified aligned, so an odd segment is the value's EXACT
  // extent rather than an extent inferred from surrounding bytes.
  for (let i = 1; i < parts.length; i += 2) {
    const value = parts[i] as string;
    const attribute = CHAIN_ATTRIBUTE_NAME_TAIL.exec(parts[i - 1] as string)?.[1];
    // EVERY name in this position IS an attribute, by the chain's grammar — so
    // the classifier is called with `inAttributes: true` and the tier-2 names
    // (`action`, `data`, `cite`, …) keep full coverage here even though they are
    // not URL-bearing as ordinary top-level property names.
    parts[i] =
      attribute !== undefined
        ? scrubString(keyPolicy(attribute, true), value)
        : stripEmbeddedUrlQueries(value);
  }
  return parts.join('"');
}

function scrubEntry(key: string, value: unknown, inAttributes = false): unknown {
  if (typeof value === "string") {
    if (key === "$elements_chain") return scrubElementsChain(value);
    // The ONE classifier decides: redact whole (a bare search term), reduce by
    // the parser (a URL — NOT gated on url-SHAPE, because the KEY is what tells
    // us the value is a URL, including a bare relative one like `products?q=1`
    // that no shape test recognises), handle an inline style, or leave the
    // value shapes intact so the deliberate identify person payload — an
    // audited email and username — is never redacted.
    return scrubString(keyPolicy(key, inAttributes), value);
  }
  // An array element inherits its PROPERTY's key, so a URL-named key still
  // reaches the URL branch. Passing "" here silently disarmed the key-gated
  // branches for an array of STRINGS, so a `href: ["/clients?search=Novakova"]`
  // kept its query while the byte-identical scalar was stripped.
  if (Array.isArray(value)) return value.map((item) => scrubEntry(key, item, inAttributes));
  if (value !== null && typeof value === "object") {
    // `$heatmap_data` is the one PostHog property whose object KEYS are URLs:
    // the heatmaps buffer is keyed by `location.href`, so the raw querystring IS
    // the key. No SDK setting substitutes for this — `maskQueryParams` rewrites
    // only NAMED campaign params (`gclid`, `fbclid`, …), so `?search=Novakova`
    // is passed through verbatim even with `mask_personal_data_properties` on.
    //
    // Buckets are MERGED rather than overwritten: two distinct querystrings on
    // one path collapse to the same key here, and `Object.fromEntries` keeps
    // only the last of a repeated key, so a naive build would make a redaction
    // rule a silent DATA-LOSS rule. The accumulator is a `Map`, not an object
    // literal, because `merged[k] = v` on a key of `__proto__` hits
    // `Object.prototype`'s setter and sets the RESULT'S PROTOTYPE instead of
    // defining an own property — dropping the bucket, which is the very failure
    // the merge exists to prevent.
    if (key === "$heatmap_data") {
      const merged = new Map<string, unknown>();
      for (const [href, bucket] of Object.entries(value)) {
        const safeHref = safeUrlOrRedact(href);
        const scrubbed = scrubEntry(href, bucket);
        const existing = merged.get(safeHref);
        merged.set(
          safeHref,
          Array.isArray(existing) && Array.isArray(scrubbed)
            ? [...existing, ...scrubbed]
            : scrubbed,
        );
      }
      return Object.fromEntries(merged);
    }
    // `$elements` is the STRUCTURED autocapture twin: its entries' keys are
    // element attributes (`href`, `attr__src`, and the tier-2 names), so the
    // walk below enters attribute context and the two representations of the
    // same DOM data get the same vocabulary. That symmetry is the thing rounds
    // 4 and 5 broke, in both directions.
    const childInAttributes = inAttributes || key === "$elements";
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, scrubEntry(k, v, childInAttributes)]),
    );
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
