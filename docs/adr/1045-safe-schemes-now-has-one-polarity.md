# ADR 1045 — `SAFE_SCHEMES` now has ONE polarity, so shrinking it is safety-monotone

**Status:** Accepted (2026-07-28) — HQ-ruled default, Martin ratify queued
(do-first doctrine). W15 wave. Landed together with the web-native-skeleton twin,
**ADR 1039**. Repairs the hazard recorded but not fixed in
[ADR 1032 §3](1032-the-blob-exemption-was-a-fail-open-branch.md); the URL
primitive owned by
[ADR 1030](1030-url-bearing-values-are-reduced-by-the-parser-or-redacted.md) is
unchanged.

## Context

`SAFE_SCHEMES` was read by four callers with **three different polarities**:

| reader                 | non-member behaviour                            | polarity     |
| ---------------------- | ----------------------------------------------- | ------------ |
| `safeUrlOrRedact`      | `return REDACTED`                               | allow-list ✓ |
| `scrubTransaction`     | routes through the primitive → redacted         | allow-list ✓ |
| `reduceSourceLocation` | `return value` — the input, RAW                 | **inverted** |
| `scrubDescription`     | skips the primitive, falls to pattern redaction | **inverted** |

Under that arrangement the set could not be maintained at all, and ADR 1032 §3
had already measured it: dropping `file:` makes the primitive start redacting
`file:` values (good) and, in the same edit, makes
`file:///android_asset/www/index.html?surname=Novakova` survive **whole** at the
other two (bad). One hole closed, two opened. The set was frozen.

The two inverted readers were not merely theoretical. They leaked for exactly the
schemes where the **path is the payload** — `data:`, `mailto:`, `tel:`, `sms:`,
`geo:` — because the fallback they dropped into is a deny-LIST:
`stripEmbeddedUrlQueries` only recognises `http/https/ws/wss`, so
`data:text/csv,Novakova;9007200004` matched nothing and left unchanged. A
`mailto:` happened to be caught by the e-mail value-shape pattern; nothing
covered the rest.

## Decision

**Make every reader an allow-list, so membership only ever means "keep more".**

`reduceSourceLocation` now consults **two** allow-lists and has no fall-through:

```ts
if (SAFE_SCHEMES.has(parsed.protocol)) return safeUrlOrRedact(value);
if (FRAME_SYNTHETIC_SCHEMES.has(parsed.protocol)) return value;
return `${parsed.protocol}${REDACTED}`;
```

`FRAME_SYNTHETIC_SCHEMES` (`app:`, `webpack:`, `webpack-internal:`, `rsc:`,
`node:`) is the new one, and writing it as a list is the point: the rule it
replaces was "anything not safe is returned raw", i.e. an exemption stated as a
claim about what a value cannot contain. Each member has a shipped producer —
Sentry's `RewriteFrames` and the Next.js SDK emit `app:///…`; webpack and
Turbopack emit `webpack-internal:///./src/x.tsx` and `webpack://_N_E/…`; RSC
frames are `rsc://React/…`; Node internals are `node:…`. None can carry a page
querystring, which is the leak the rule exists for.

`scrubDescription`'s unsafe-scheme arm becomes the same shape: a non-safe scheme
is redacted to its scheme rather than falling through to pattern redaction.

**Redact-TO-SCHEME rather than to a bare `[Filtered]`** is deliberate. The scheme
is this module's own literal and carries no author bytes, and keeping it lets a
reader tell a rewritten frame from a hostile one — `data:[Filtered]` is a more
useful issue-grouping key than `[Filtered]`. The relative/unparseable branch of
`reduceSourceLocation` still returns its input byte-identical: no scheme means no
page URL, so there is nothing there to lose.

## Consequences

- **Shrinking `SAFE_SCHEMES` is now safety-monotone at every reader.** That is
  the property, and it is pinned by a test that does not name a scheme: for a set
  of unlisted schemes, EVERY reader must answer with a redaction and must not
  contain the payload. Re-introduce either inverted reader and it reds without
  anyone having to think of the scheme that exposes it.
- **The set is now movable, and two of its entries fail its own membership rule —
  but the set is NOT moved here.** Verified: neither skeleton has a
  `@capacitor/*` or `@ionic/*` dependency in any package.json, and neither
  references them in any source file; the mobile app is Expo / React Native,
  which has no page URL at all. So `capacitor:` and `ionic:` have no producer we
  ship, which is precisely the removal condition the block states for itself.
  They are left in place and flagged, for two reasons: removing them is a
  BEHAVIOUR change (a `capacitor://` value would go from origin+path to
  `[Filtered]`) with no measured gain, since the query is already dropped for
  them; and it belongs to its own decision rather than riding along with the
  polarity repair that merely made it possible.
- **`file:` stays, on a corrected argument.** The old comment justified it as a
  Capacitor/native PAGE origin, which is false for this tree. The real producer
  is Node's ESM loader: an ESM stack frame is `file:///…/dist/x.js`, so removing
  `file:` would redact every server frame's `filename` and break source-map
  resolution — the very thing the source-location rule protects. The entry is
  right; the reason written next to it was not.
- Disarm-verified against the landed tree: restoring
  `reduceSourceLocation`'s raw return reds 6 cases; restoring
  `scrubDescription`'s skip reds 5; the scheme-agnostic monotonicity assertion
  reds under BOTH. 648 tests green with the fix.
- A whitespace-free, colon-bearing description that is not a URL (`redis:GET`)
  now redacts to `redis:[Filtered]`. Accepted: the branch only fires when the
  WHOLE description is one token the URL parser accepts, real Sentry descriptions
  of that shape are overwhelmingly URLs, and this module's stated policy is to
  fail toward over-redaction. SQL, prose and dotted op labels all contain either
  a space or no colon and are pinned unchanged by tests.

## Sources

- ADR 1032 §3's measurement of the three-polarity hazard, now discharged.
- `grep` for `@capacitor`/`@ionic` across both skeletons' package.json and source
  trees, 2026-07-28 — no hits.
- Test runs and the three mutations above, this box, 2026-07-28.
