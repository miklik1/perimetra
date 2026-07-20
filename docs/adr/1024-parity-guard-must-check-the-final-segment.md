# ADR 1024 — the `$elements_chain` parity guard must check the FINAL segment too

**Status:** Accepted (2026-07-20) — HQ-ruled default, Martin ratify queued (do-first doctrine, security lane). Corrects the guard established by [ADR 1020](1020-elements-chain-parity-must-be-verified.md), which [ADR 1022](1022-elements-chain-non-href-segments.md) now depends on.

**Provenance — perimetra-authored, found by the adversarial review of this repo's own channel-A wave-5 drain. OWED UPSTREAM** to `fullstack-skeleton` (which authored neither guard — ADR 1020 was paid up to it from here, so it carries this defect too) and to `web-native-skeleton`. `anyora-platform` carries the ADR 1013 lineage but not the ADR 1020 parity guard, so it is unaffected by this specific gap.

## Context

ADR 1020 established that quote parity in a serialized `$elements_chain` must be **verified against the chain grammar** rather than assumed, because `posthog-js` concatenates `element.tag_name` unescaped and the HTML tokenizer will happily put a bare `"` inside a tag name (`<span"x>` parses to localName `span"x` — re-confirmed against jsdom and the real `getElementsChainString` during this review). The guard it shipped reads:

```ts
for (let i = 0; i < parts.length - 1; i += 2)
  if (!CHAIN_STRUCTURE_SEGMENT_TAIL.test(parts[i] as string))
    return CHAIN_HAS_HREF.test(chain) ? REDACTED : chain;
```

The bound `parts.length - 1` deliberately exempts the **final** even segment, on the reasoning that it is trailing text after the last closing quote rather than an attribute name that opens a value, and so has no reason to end in `=`.

**That exemption is exactly where a shifted split parks the href value.** Consider a chain carrying one injected bare quote and ending mid-value:

```
x="y:attr__href="https://app.cz/p?token=SECRETTOK
```

It splits to `['x=', 'y:attr__href=', 'https://app.cz/p?token=SECRETTOK']`. The loop visits index 0 only — `'x='` ends in `=`, so the chain is admitted as aligned. But the split is off by one: the href VALUE sits at the exempt even index 2, where it is read as a structure segment and never scrubbed, while `'y:attr__href='` is read as the value and is not href-shaped. **The chain returns byte-identical with the token intact** — the same total-failure mode ADR 1020 exists to prevent, surviving in the one position ADR 1020's own loop does not inspect.

This is a defect in the guard, not in ADR 1022. But ADR 1022 raises the stakes: its soundness argument explicitly rests on "the parity loop has already VERIFIED the split before the rewrite loop runs", and a guard with an unchecked position does not deliver what that sentence claims.

**Reachability, stated honestly.** The review could not produce this shape from the real `posthog-js` serializer. Both realistic tag_name-injection chains it generated — the injected quote inside an element's own tag name, and the truncated tail variant — begin with a segment that does NOT end in `=` (`'span'`, `'a'`), so the existing loop rejects them at index 0 and they correctly become `[Filtered]`. Exploiting the exempt position additionally requires every earlier even segment to end in `=`, which the observed chain shapes do not give an attacker for free. So this is **defense-in-depth on a guard whose stated property was false, not a demonstrated live leak** — and it is fixed because the guard is load-bearing for two ADRs and the correction costs nothing.

## Decision

**Check every even segment, including the last — requiring the last to be EMPTY rather than to end in `=`.**

```ts
for (let i = 0; i < parts.length; i += 2) {
  const segment = parts[i] as string;
  const aligned =
    i === parts.length - 1 ? segment === "" : CHAIN_STRUCTURE_SEGMENT_TAIL.test(segment);
  if (!aligned) return CHAIN_HAS_HREF.test(chain) ? REDACTED : chain;
}
```

**The tightening is free, and that is why it is the right shape.** A well-formed chain ends on a closing quote, so splitting on `"` always leaves a trailing empty segment — the exempt position is `""` in every legitimate chain, never arbitrary text. The exemption was therefore never buying anything; it was only widening the guard's blind spot. Requiring `""` is strictly stronger than requiring `=$` there, and strictly stronger than the previous "check nothing".

The odd-quote-count case is untouched: when the quote count is odd, `parts.length` is even, the last index is **odd** (a value), and the last even index is `parts.length - 2`, which the `=` rule already covered. That is what preserves ADR 1018's deliberate truncated-chain behaviour (`a:attr__href="/p?q=1` still scrubs to `a:attr__href="/p`).

## Consequences

- **The guard now delivers the property its own ADR claims**, so ADR 1022's "the split has already been verified" is true of every position rather than all-but-one.
- **No behaviour change on any legitimate chain.** Every pre-existing test passes unchanged; the two new tests pin the closed hole and the still-accepted well-formed chain whose final segment is empty. Disarm-verified: restoring the bounded loop fails exactly the new rejection test.
- **The generalisable lesson, and it is a different one from ADR 1020's.** ADR 1020's lesson was about the PRODUCER (a precondition about who escaped a byte is only as strong as the weakest field concatenated unescaped). This one is about the CHECKER: **an exemption carved into a validator for a "can't matter" position is precisely where a shifted frame lands, because shifting the frame is what changes which position is which.** When a guard verifies an alignment, it must verify it everywhere the alignment can be wrong — a loop bound is part of the security argument, not an implementation detail. Distilled to the vault as its own finding.
- **This module has now been corrected four times from review rather than from the gate** (ADR 1015, 1020, 1022/1023, this one). The pattern named in ADR 1022 holds: a cold-green gate does not find missing coverage, and a claim written in a comment does not stay true just because the tests still pass.
- **Fleet exposure.** `fullstack-skeleton` and `web-native-skeleton` carry the ADR 1020 guard with the same bound and owe this fix.

## Sources

- [ADR 1020](1020-elements-chain-parity-must-be-verified.md) — the guard this corrects.
- [ADR 1022](1022-elements-chain-non-href-segments.md) — the rule that now depends on the guard being complete.
- [ADR 1018](1018-elements-chain-quote-alternation.md) — the truncated-chain behaviour this preserves.
- Re-confirmed this session against jsdom 29 and `posthog-js@1.379.2` `getElementsChainString`: `<span"x>` yields localName `span"x`, and the emitted chain carries that bare quote unescaped.
