# ADR 1022 — `$elements_chain` scrubs every value segment, not only the `href` ones

**Status:** Accepted (2026-07-19) — HQ-ruled default, Martin ratify queued (do-first doctrine, security lane). Extends [ADR 1013](1013-posthog-analytics-url-scrub.md); relies on the parity guarantee established by [ADR 1020](1020-elements-chain-parity-must-be-verified.md).

**Provenance — a DOWNSTREAM find, paid back upstream.** Found by the adversarial review that `anyora-platform` ran over its own drain of this repo's analytics-sink work (anyora ADR 0076, `83c1f32`). The defect is **this repo's**: the rule shipped here in ADR 1013 and every repo stamped from it inherited the gap. Anyora fixed its copy and recorded the debt; this ADR is that debt paid, adapted to the stronger guarantee this repo has since acquired in ADR 1020.

## Context

`scrubElementsChain` splits the chain on `"` and rewrites the odd-index value segments. Since ADR 1013 it rewrote **only** the segments whose preceding structure segment matched `CHAIN_HREF_NAME_TAIL` — that is, only values belonging to an `href` / `attr__href` attribute. Every other value segment was returned byte-for-byte.

That is not where the URLs stop. `posthog-js` serializes **every** attribute of a non-sensitive element into the chain (`attr__src`, `attr__value`, `attr__data-*`, …) and folds the clicked element's `text` in as well. So the chain routinely carries URLs under names the href rule does not match:

```
img:attr__src="https://app.cz/avatar?email=jan@example.cz"nth-child="1"
button:nth-child="1"text="Kopirovat https://app.cz/p/x?token=SECRETTOK"
```

Both shipped with the query intact on every `$autocapture` event.

**What makes this a defect rather than a scope choice is the asymmetry inside a single call.** The same values also reach `sanitizeAnalyticsProperties` under `$elements` (an array of objects, so the object branch restores real keys) and under `$el_text`. Neither `attr__src` nor `$el_text` matches `ANALYTICS_URL_KEY`, so both fall through to `stripEmbeddedUrlQueries` — the generic embedded-URL pass — and **are** stripped. The byte-identical bytes were therefore redacted under one property and emitted in the clear under another, in the same event, by the same function. `$elements_chain` is the field PostHog's ingestion actually reads, so the surviving copy is the one that matters.

The module's own header explains why the generic pass is not run over the whole chain: its tail would run past a value's closing quote and shred the following attributes and ancestors. That reasoning is correct **for the whole chain** and was over-generalised into "the generic pass has no place in this function".

## Decision

**Every value segment is scrubbed; the rule differs by segment, not the coverage.** An `href` value is the entire URL, so its query is cut outright with `dropUrlQuery`. Every other value segment gets exactly the generic embedded-URL pass an ordinary string property would get.

```ts
parts[i] = CHAIN_HREF_NAME_TAIL.test(parts[i - 1] as string)
  ? dropUrlQuery(value)
  : stripEmbeddedUrlQueries(value);
```

**Why this is byte-safe, stated at the strength this repo can actually claim.** The hazard the header describes is a pass whose tail runs past a delimiter. Applied per-segment it cannot: an odd segment is the value's exact extent, and `stripEmbeddedUrlQueries` only ever **deletes** characters — it can never introduce a `"` — so the quote count is preserved and the rejoin stays byte-aligned with the structure segments, which are not touched at all.

The upstream copy of this fix in anyora rests "an odd segment is the value's exact extent" on the no-`\"` precondition. **This repo does not need that precondition, and should not use it** — ADR 1020 proved it unsound on its own. Here the parity loop has already _verified_ the split against the chain grammar before the rewrite loop runs, and bails to the ambiguous-case policy when verification fails. So the extent claim is checked rather than assumed, and the generic pass provably never runs on a chain whose split has slipped. That interaction is pinned by its own test.

## Consequences

- **The silent asymmetry is gone.** A URL in the chain is now treated the same as the identical URL under `$elements` / `$el_text`, which is the property a redaction module most needs: no field where the bytes survive because of how they happened to be serialized.
- **Known residue, deliberately matching the `$elements` path rather than diverging from it.** A _relative_ URL in a non-href attribute (`attr__src="/avatar?x=1"`) keeps its query, because the generic pass needs a `://` or a dotted `//host`. This is not a new gap — the `$elements` object path has exactly the same one, for the same reason. Closing it here would mean `dropUrlQuery` on every value segment, which truncates ordinary label text at a legitimate `?` ("Smazat klienta?") and would put the chain _ahead_ of `$elements` in aggressiveness, creating a fresh asymmetry pointing the other way. If this is ever closed it should be closed in both places at once.
- **Over-redaction risk is bounded and tested.** The only values now touched that were not before are non-href segments containing a `://` or a dotted `//host`. A confirmation label with a bare `?` is asserted unchanged.
- **This widened the ambiguous-chain keep-branch's cost, and the old justification for that branch silently became false.** `CHAIN_HAS_HREF` gates the drop on an unparseable or parity-slipped chain, and its stated rationale was that with no href "the only mutation this scrub performs is provably a no-op, so dropping would destroy the whole element tree for zero redaction gain". That was true when written and is not true after this ADR: a kept href-less chain can now carry a non-href embedded URL query that the scrub would otherwise have stripped, and unlike the parseable case that residue is _not_ covered by the `$elements` path either. **The policy does not change** — the residue is bounded to the `stripEmbeddedUrlQueries` class, against destroying the entire element tree on the overwhelming majority of autocapture events — but the comment and its mirrored test rationale were corrected in this commit rather than left asserting a property the change had invalidated. Recorded because it is the failure mode this module keeps producing: _a change that is correct in itself can falsify a soundness claim written elsewhere, and nothing in a green gate detects that._ It was caught by an adversarial doc-accuracy lens, not by the suite.
- **Fleet exposure.** Every repo stamped at or after the ADR 1013 commit carries the narrow version and must drain this. `anyora-platform` already has it (it is where the find came from); `web-native-skeleton` carries the rule in its own lineage and is fixed in lockstep with this commit as its ADR 1015.
- **The review pattern repeats, and is worth naming.** This is now the third correction to this module that arrived from a _downstream drain_ rather than from the gate here (ADR 1015, ADR 1020, this one). A cold-green gate does not find missing coverage — only someone asking "what else reaches this sink?" does. That question belongs at the source, before a wave ships.

## Sources

- [ADR 1013](1013-posthog-analytics-url-scrub.md) — the analytics sink and the original `$elements_chain` rule.
- [ADR 1020](1020-elements-chain-parity-must-be-verified.md) — the parity verification this fix relies on to make its extent claim sound.
- `anyora-platform` ADR 0076 (`83c1f32`) — the downstream fix this pays back.
- Vault: `An SDK that emits data twice — structured and serialized — needs the serialized twin scrubbed by its own rule`.
