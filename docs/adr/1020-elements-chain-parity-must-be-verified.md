# ADR 1020 — `$elements_chain` quote parity is VERIFIED against the chain grammar, not assumed from the absence of `\"`

**Status:** Accepted (2026-07-19) — HQ-ruled default, Martin ratify queued (do-first doctrine, security lane). Corrects the soundness argument of [ADR 1018](1018-elements-chain-quote-alternation.md), which corrected [ADR 1013](1013-posthog-analytics-url-scrub.md). **Owed upstream** to `fullstack-skeleton` (the defect is byte-identical there at `2012000`) and to `web-native-skeleton`.

**Provenance.** Found by adversarial review of this repo's own wave-4 drain, minutes after that drain was committed — not inherited from upstream. Reproduced by driving the REAL `posthog-js` serializer (`autocapturePropertiesForElement` → `getElementsChainString`) over a jsdom DOM and feeding the emitted chain to the real exported `sanitizeAnalyticsProperties`, then independently re-reproduced by a second reviewer before acceptance.

## Context

ADR 1018 replaced a plantable start anchor with quote alternation, resting the whole argument on one precondition:

> With no `\"` anywhere, every `"` IS a real delimiter.

**That precondition is false, and the failure is total rather than partial.** It only rules out quotes that the ESCAPER produced. It says nothing about quotes that never went through the escaper — and `posthog-js` does not escape every field it concatenates into the chain. `escapeQuotes` is applied to attribute keys and values (`autocapture-utils.js:603`), and quotes are stripped from class names (`:582`), but `element.tag_name` is concatenated **raw** (`:574-575`, `el_string += element.tag_name`), sourced unfiltered from `elem.tagName.toLowerCase()` (`autocapture.js:64`).

A tag name can contain a `"`. Per the HTML tokenizer's tag-name state a `"` is an "anything else" code point and is APPENDED to the tag name, so `<span"x>` parses to `localName` `span"x` (verified in jsdom). The chain then carries a bare quote with **no backslash**, so `CHAIN_HAS_AMBIGUOUS_ESCAPE` never fires, the split path is taken, and the parity is shifted by one: every href value lands at an EVEN index, is read as a structure segment, and is never passed to `dropUrlQuery`.

Executed against the real serializer, clicking the span in
`<div id="root"><a href="/clients?search=Novakova&rc=7001011234"><span"x>Klienti</span></a></div>`:

```
chain    span"x:attr__href="/clients?search=Novakova&rc=7001011234"…;a:attr__href="/clients?search=Novakova&rc=7001011234"…
contains \"   ?  no
scrubbed        BYTE-IDENTICAL to the input — 4 surviving copies of search=Novakova&rc=7001011234
control  same chain with `span"x` → `span`:  fully scrubbed to attr__href="/clients"
```

So a single unescaped quote is the whole difference between total redaction and **zero** redaction — of a surname beside a rodné-číslo-shaped value, in the app's OWN href query.

**An odd-quote-COUNT check is not a sufficient fix**, and this was verified rather than assumed: two injected tag-name quotes restore an EVEN count while still shifting parity for the first href (`a"b:attr__href="/c?q=PII1"…;d"e:attr__href="/c?q=PII2"…` leaks PII1 and scrubs PII2).

**Reachability, stated honestly.** The only route to a quote inside a tag name is the HTML parser: `createElement`/`createElementNS` validate the name and throw, and XHTML is XML-parsed and would reject it. So it requires malformed markup reaching the page — injected or user-supplied HTML, CMS rich text, `dangerouslySetInnerHTML`, a markdown renderer passing raw HTML through, or a third-party embed. It is not the default path. It IS squarely inside the threat model this module states for itself two comments earlier ("whoever controls an href controls the bytes the heuristic reads, so no local rule is sound"), and the attacker does not need to control the href at all — only to plant a malformed tag at, or below, the clicked element, after which the application's own PII query leaks. The malformed tag must be the click target or sit between the target and the href-bearing ancestor; a malformed tag ABOVE the href does not leak, because chain order is `[target, …ancestors]`.

## Decision

**Parity is verified against the chain grammar before it is relied upon.** In a well-formed chain every even-index segment except the last is a run of `…name=` text ending at the quote that opens the next value, so it MUST end in `=`. A segment that does not is proof the parity has slipped. Such a chain is handed to the SAME ambiguous-case policy a `\"` chain already gets: dropped when it carries an href, kept untouched when it does not.

```ts
for (let i = 0; i < parts.length - 1; i += 2)
  if (!CHAIN_STRUCTURE_SEGMENT_TAIL.test(parts[i] as string))
    return CHAIN_HAS_HREF.test(chain) ? REDACTED : chain;
```

The check runs before the rewrite loop, so a chain whose grammar does not hold is never partially rewritten.

**Every deliberate behaviour of ADR 1018 is preserved**, which is what makes this cheap rather than a re-litigation — each is pinned by a test: the planted-`href=` label of ADR 1018 defect 1 (its even segments all still end in `=`, so it still scrubs), the truncated odd-quote chain (`a:attr__href="/p?q=1` → `a:attr__href="/p`, still the intended over-redaction rather than a drop), the href-less ambiguous Czech label (still kept whole), and the structure-only chains (byte-preserved).

## Consequences

- **The redaction gate closes on a shape that previously passed through with zero redaction.** The cost is one more class of chain dropped rather than scrubbed — and only for chains whose grammar is already broken, which are by construction not chains the parser can be trusted to have produced cleanly.
- **The generalisation, now stated for the third time and finally at the right level.** Skeleton ADR 1015 said a rule inferring a string boundary from LOCAL CONTEXT can be defeated by planting that context. ADR 1018 moved the inference from the value's end to its start and was defeated the same way. This ADR is the same class again, one level up: **a precondition about who ESCAPED a byte is only as strong as the weakest field the producer concatenates unescaped.** The defence is not a better inference — it is to VERIFY the structural assumption against the data before relying on it, and to fall back to the safe policy when verification fails. That is now the module's stated discipline.
- **A green gate and a five-lens review both passed the ADR 1018 code.** This was found only by an attacker driving the REAL producer (posthog-js over jsdom) rather than hand-writing chains that already assumed the grammar. Restating the ADR 1013 method note: for a parser-adjacent scrub, generate the input with the actual emitter, or the test suite only ever confirms the author's own model.
- **Owed upstream, and NOT yet paid.** `fullstack-skeleton` at `2012000` and `web-native-skeleton` carry the identical rule and therefore the identical leak. Perimetra is ahead of both until that debt is paid, exactly as it was for ADR 1013 → skeleton ADR 1015. Any repo draining `2012000` inherits the leaking version.
- **Worth reporting to posthog-js:** the chain it emits is not self-consistently escaped — `escapeQuotes(element.tag_name)` is missing at `autocapture-utils.js:574-575`. Fixing it upstream would remove the injection at the source; this ADR does not depend on that happening.

## Sources

- [ADR 1018](1018-elements-chain-quote-alternation.md) — the quote-alternation rule whose precondition this corrects.
- [ADR 1013](1013-posthog-analytics-url-scrub.md) — the analytics sink, and the origin of the boundary-inference generalisation.
- `posthog-js` (installed version) `lib/src/autocapture-utils.js:566` (`escapeQuotes`), `:574-575` (raw `tag_name` concatenation), `:582` (class-name quote stripping), `:603` (attribute key/value escaping); `lib/src/autocapture.js:64` (`elem.tagName.toLowerCase()`).
- WHATWG HTML: tokenizer tag-name state — `"` is an "anything else" code point and is appended to the tag name.
