# ADR 1018 — The `$elements_chain` scrub parses by quote alternation instead of inferring the href's start

**Status:** Accepted (2026-07-19) — HQ-ruled default, Martin ratify queued (do-first doctrine, security lane). Corrects the `$elements_chain` rule of [ADR 1013](1013-posthog-analytics-url-scrub.md) (whose generalisation was carried upstream as skeleton ADR 1015). Drained from skeleton `2012000` (upstream ADR 1018).

**Provenance.** Not found here. Both defects were found by adversarial review during the `web-native-skeleton` drain, on that repo's copy of the same rule, then paid as a debt into `fullstack-skeleton`; this repo carried the identical rule and so inherited the identical defects. The port is near-literal — the chain scrub is local to `analytics-scrub.ts` in all three repos, and only the import source differs.

Both defects were reproduced by executing this repo's real exported `sanitizeAnalyticsProperties` against a constructed chain, not reasoned about from the regex.

## Context

Two defects: one leak, one over-redaction.

**1. The href start anchor is plantable (leak).** ADR 1013 established a sound premise — with no `\"` anywhere in the chain, every `"` is a real delimiter — and then drew an unsound conclusion from it: that `((?:attr__)?href=")([^"]*)(")` is therefore "exactly correct". Delimiter soundness constrains where a value can _end_. It says nothing about where a match may _start_. The rule infers the start from the literal bytes `href="`, and those bytes are plantable inside any serialized attribute value that ends with `href=` — needing no quote of its own, and therefore producing no `\"` for the `CHAIN_HAS_AMBIGUOUS_ESCAPE` guard to detect.

`posthog-js` folds the clicked element's `text` into the chain as an attribute and sorts attributes with `localeCompare`, which places `text` last — immediately before the ancestor element's `attr__href`. A link label ending in `href=` therefore opens a bogus match whose closing group _is_ the real href's opening quote; `lastIndex` lands past it, and the real value is never scrubbed:

```
page    <a href="/invite/accept?token=SUPERSECRET"><span>Paste the value after href=</span></a>
in      span:nth-child="1"text="Paste the value after href=";a:attr__href="/invite/accept?token=SUPERSECRET"nth-child="2"
ADR1013 span:nth-child="1"text="Paste the value after href=";a:attr__href="/invite/accept?token=SUPERSECRET"nth-child="2"   (LEAKS)
```

The planted label need not be the attacker's own; any user-supplied link text reaches it. Note the shape requirement: the bogus match only swallows the real opening quote when the planted `href=` sits at the very end of the last attribute before the href. That is exactly what `localeCompare` ordering arranges, which is why this is a live shape rather than a curiosity.

This is the defect class ADR 1013 itself generalised and declared closed — "any rule that infers a string boundary from local context can be defeated by planting that context inside the value". The fix had moved the inference from the value's end to its start and left it equally plantable.

**2. The unconditional drop destroys href-less chains (over-redaction).** `CHAIN_HAS_AMBIGUOUS_ESCAPE.test(value)` was evaluated on the whole chain and was not conditioned on the chain actually containing an href. If there is no `href="` in it, the scrub's only mutation is provably a no-op, so returning `[Filtered]` removed the entire element tree while removing nothing.

`posthog-js` escapes every captured attribute value and the element `text`, and it captures `aria-label` even on elements it classifies as sensitive. So one straight double quote in an ordinary Czech UI label — `Smazat "Faktura 42"` — was enough to nuke the chain. Most autocapture events are clicks on buttons and divs, which carry no href at all: the majority case was the destroyed one. In a Czech-locale product whose UI labels quote document numbers routinely (ADR 0112 invoices, quote numbers), that majority case is the norm, not an edge.

## Decision

1. **The chain scrub infers no extent at all — it parses by quote alternation.** Under the no-`\"` precondition the quotes alternate exactly, so `chain.split('"')` yields structure segments at even indices and values at odd ones. (**Corrected by [ADR 1020](1020-elements-chain-parity-must-be-verified.md):** the no-`\"` precondition is FALSE as a proof that every `"` is a delimiter — it only rules out quotes the escaper produced, and `posthog-js` concatenates `element.tag_name` unescaped, so `<span"x>` injects a bare quote that shifts the parity and made the chain pass through with ZERO redaction. Parity is now VERIFIED against the chain grammar before it is relied upon. The alternation mechanism below stands; only the claim that its precondition was self-establishing was wrong.) An odd segment is an href value if and only if the structure segment immediately before it ends in an href attribute name (`CHAIN_HREF_NAME_TAIL`) — a position no value can occupy, because values are odd segments by construction. There is no start left to plant. Rejoining on `"` is byte-exact, so nothing outside an identified href value is altered.

   The narrow claim above is the one the argument needs, and the one that is true. It is **not** the stronger claim that a malformed or odd-quote-count chain round-trips unchanged: on an odd quote count the trailing segment is unterminated, yet it is still indexed as a value and still passed through `dropUrlQuery`, so `a:attr__href="/p?q=1` returns `a:attr__href="/p`. That behaviour is correct and intended — the no-`\"` precondition guarantees a real delimiter opened the segment, so it genuinely is a truncated href value, and scrubbing it is the intended over-redaction (posthog-js truncating a long chain mid-value is the realistic producer). A test pins the odd-quote case so the claim stays backed.

   The name tail requires a non-name character before the (optional, literally spelled) `attr__` prefix, so `attr__data-xhref=` is not read as an href.

2. **The drop is gated on the chain actually containing an href** (`CHAIN_HAS_HREF`). An href always serializes as `href="` + value + `"`, and `attr__href="` contains that same byte sequence, so the _absence_ of those bytes proves there is no href value anywhere — the one conclusion that stays sound on a chain too ambiguous to parse. The check is a case-insensitive regex rather than `String.includes`, because `HREF="` is reachable — though **not** by the mechanism a sibling repo's earlier revision gave. "SVG in foreign content preserves attribute-name case" is false: the HTML tokenizer's attribute-name state lowercases ASCII upper-alpha unconditionally and is not context-sensitive to foreign content, and the tree builder's adjust-SVG-attributes step restores camelCase for a fixed table only (`viewBox`, `baseFrequency`, …) — itself proof the tokenizer lowercased first, since it must repair `viewbox`. Bare `href` has no entry in that table (only `xlink:href`, via adjust-foreign-attributes), so `<svg><a HREF="x">` parses to `href`. The genuinely reachable routes are `document.createElementNS(SVG_NS, "a").setAttribute("HREF", …)` — `setAttribute` lowercases only for HTML-namespace elements in HTML documents — and markup served as `application/xhtml+xml`. posthog-js keys the chain off the raw attribute name (`props["attr__" + attr.name]`) with no case normalisation, so `attr__HREF` is producible either way. `/i` only ever widens the redaction gate.

3. **The drop branch is otherwise unchanged.** An ambiguous chain that _does_ contain an href is still dropped whole. Quote alternation is not sound in the presence of `\"`, and nothing here changes that.

4. **The `CHAIN_HREF_NAME_TAIL` boundary class is documented in both directions and pinned.** It excludes only `a-z0-9_-`, so `:` and `.` satisfy it — wanted for `xlink:href` (React renders `xlinkHref` to exactly that), at the accepted cost that a framework binding expression surviving into the DOM (Alpine's `x-bind:href` / `:href`) is truncated at its ternary `?`. That is over-redaction of autocapture detail, never a leak; this repo does not ship Alpine, and it is not a regression either — the superseded global `href="` rule admitted the same names identically.

## Consequences

- **A chain now keeps its element detail in two cases where it previously lost everything:** when it is ambiguous but href-less, and when a value merely contains the bytes `href=`. Both outcomes are strictly safer _and_ strictly more useful than before, which is unusual — the previous rule was simultaneously over-redacting on the common case and under-redacting on the planted one.
- **Regression coverage.** Tests in `packages/telemetry/src/analytics-scrub.test.ts` were verified to fail against the ADR 1013 rule and pass against this one: the planted-`href=` repro (asserting the token is absent _and_ that the rest of the chain is byte-exact), the `attr__data-xhref` non-match, the ambiguous-but-href-less Czech label surviving intact, the odd-quote case, the namespaced/dotted names in both directions, and the case-insensitive drop gate. As ADR 1013's own corrected consequence notes: a test pins a regression, it does not evidence coverage of a class. These pin the shapes described above and nothing wider.
- **ADR 1013's sentence "`[^"]*` is exactly correct" is now false** and is corrected here rather than edited there — ADRs supersede, they do not rewrite history.
- **`packages/telemetry/src/scrub.ts` was not touched by this ADR.** The chain scrub lives only in `analytics-scrub.ts`; the inline-regex Sentry scrub has no `$elements_chain` rule to fix. The key-list gaps in that file are ADR 1017's and [ADR 1019](1019-analytics-array-key-credential-vocabulary-and-net-host-ip.md)'s, both landing in the same commit as this one.
- The remaining sibling finding — `scrubEntry`'s array branch discarding the property key — is **closed by [ADR 1019](1019-analytics-array-key-credential-vocabulary-and-net-host-ip.md)** in this same commit, so this repo books no debt from it.

## Sources

- [ADR 1013](1013-posthog-analytics-url-scrub.md) — the analytics sink this scrub belongs to, and the rule this corrects.
- Skeleton ADR 1015 — the generalisation ("boundary inference is unsound") that this defect restores; authored from this repo's own work and pushed upstream, so it has no local file.
- `web-native-skeleton` ADR 1011 — the originating write-up of both defects.
- `posthog-js` (installed version), `dist/module.no-external.js`: the escape `replace(/"|\\"/g,'\\"')`; the attribute bag built as `{...(text ? {text} : {}), "nth-child", "nth-of-type", ...(href ? {href} : {}), ...attributes}` then `.sort((a, b) => a[0].localeCompare(b[0]))` and serialized as `name + '="' + value + '"'`. `text` therefore sorts last within its own element, immediately before the `;` and the ancestor element's `attr__href`.
- WHATWG HTML: tokenizer attribute-name state; tree construction "adjust SVG attributes" table; DOM `setAttribute` lowercasing condition.
