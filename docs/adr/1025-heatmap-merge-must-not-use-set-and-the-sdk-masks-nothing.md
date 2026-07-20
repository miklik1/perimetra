# ADR 1025 — the `$heatmap_data` merge must not build by `[[Set]]`, and no SDK flag substitutes for the scrub

**Status:** Accepted (2026-07-20) — HQ-ruled default, Martin ratify queued (do-first doctrine, security lane). Corrects two claims and one implementation detail of [ADR 1023](1023-heatmap-data-url-keys.md).

**Provenance — perimetra-authored, found by the adversarial review of this repo's own channel-A wave-5 drain. OWED UPSTREAM** to `fullstack-skeleton`, `web-native-skeleton` and `anyora-platform` — ADR 1023 originated upstream and all three carry both defects verbatim.

## Context

ADR 1023 closed a real hole: `$heatmap_data`'s object KEYS are page URLs, and a walk that reads keys and rewrites values is structurally blind to them. Its central insight — that **merging** the collapsed buckets is load-bearing, because dropping the query maps distinct keys onto one path and a naive build would silently destroy interaction data — is correct and is kept.

Two things it got wrong survived into this repo with the drain.

### 1. The merge reintroduces the data loss it exists to prevent, through `__proto__`

The shipped loop accumulates into an object literal by assignment:

```ts
const merged: Record<string, unknown> = {};
merged[safeHref] = /* … */;
```

`merged[k] = v` is a `[[Set]]`. For `k === "__proto__"` that invokes the `Object.prototype.__proto__` setter rather than defining an own property: the bucket becomes the **prototype** of the result and no own key is created. Reproduced against the real exported function:

```
IN  own keys: ["__proto__", "https://a.cz/b?q=1"]
OUT own keys: ["https://a.cz/b"]          // the __proto__ bucket is GONE
Object.getPrototypeOf(out) is an Array    // it became the prototype
```

**This is the exact failure the merge was written to prevent**, arriving through a door the ADR did not look at. It is also a self-inflicted divergence: every other branch in the module builds its result with `Object.fromEntries`, which uses `CreateDataProperty` and has never had this behaviour. The one branch that departed from the module's own idiom is the one that broke.

Reachability is thin — it needs a page URL that is literally `__proto__` after query-dropping — so this is a robustness and consistency defect rather than a live leak. It is fixed because the cost is one line and because a redaction rule that silently loses data is the thing ADR 1023 itself says gets ripped out.

### 2. "The SDK masks it only when `mask_personal_data_properties` is set" implies a false alternative

ADR 1023, and the code comment mirroring it, both say the heatmap href is masked by the SDK "only when `mask_personal_data_properties` is set, which defaults to false". The **default is stated correctly**, but the sentence asserts a sufficient condition that does not hold, and a reader takes the obvious inference: turn the flag on and the scrub is redundant.

Reading `posthog-js@1.379.2`: `heatmaps.js` passes only `PERSONAL_DATA_CAMPAIGN_PARAMS` (plus any `custom_personal_data_properties`) into `maskQueryParams` (`utils/request-utils.js`), which rewrites **just those named params** — `gclid`, `gclsrc`, `dclid`, `gbraid`, `wbraid`, `fbclid`, … With the flag ON, `https://app.cz/clients?search=Novakova` is passed through **unchanged**. The SDK never masks an arbitrary query key here, at any setting.

The correct claim is therefore **stronger** than the one written, and the difference is operationally dangerous in exactly one direction: the weaker sentence licenses a derived repo to flip an SDK flag _instead of_ draining this fix, and ship the leak ADR 1023 exists to close while believing it is covered.

## Decision

**Accumulate in a `Map`, finish through `Object.fromEntries`.** This keeps the merge, removes the `[[Set]]`, and returns an ordinary object like every other branch — rather than an `Object.create(null)` accumulator, which would also fix it but hands callers a surprising null-prototype value.

**State the SDK claim at its true strength** in both the ADR and the code comment: no `posthog-js` setting masks an arbitrary query key in `$heatmap_data`, so this scrub is the only thing standing between the heatmaps buffer and the sink.

**Also corrected here: `stripEmbeddedUrlQueries` preserves OUR parse, not the bytes we EMIT.** ADR 1022's comment says the pass "only ever DELETES characters — it can never introduce a `\"` — so the quote count is preserved and the rejoin stays byte-aligned". True of our own split and rejoin. But deleting to end-of-segment can leave a value ending in a backslash that the query previously separated from the delimiter, so the rejoin can emit a `\"` the input did not contain: `attr__src="https://a.cz/x\?q=1"` scrubs to `attr__src="https://a.cz/x\"`. Our alignment is unaffected (we already split) and re-running the scrub on its own output is safe — the `\"` trips the ambiguity gate and an href-less chain is kept. The residue is that PostHog's ingestion sees a chain one escape more ambiguous than the SDK emitted, i.e. degraded element detail on an input that already had to contain a stray backslash before a query. **Recorded, not fixed:** making it exact would require re-escaping on the way out, which mutates bytes outside the matched query and is a strictly larger hazard than the one it removes. A test pins the behaviour so the comment cannot drift back into over-claiming.

## Consequences

- **The merge is now safe for every key**, and the module has one idiom for building result objects instead of two.
- **No repo can now read this module and conclude a config flag covers it.** That was the actually-costly error of the two — a wrong severity assessment propagates further than a wrong line of code.
- **Third instance of ADR 1022's own named failure mode**, and worth stating because it keeps recurring in this file: a claim that is true when written, or true of a narrower scope than the sentence covers, is invisible to a green gate. ADR 1022 caught it in the `CHAIN_HAS_HREF` rationale; this ADR catches it twice more, in ADR 1023's SDK claim and in ADR 1022's own emitted-bytes claim. **The rule this repo should carry: a comment asserting a security property needs a test pinning that property, or it is prose that decays silently.** Distilled to the vault as its own finding.
- **Fleet exposure.** All three sibling repos carry both defects verbatim and owe this fix.

## Sources

- [ADR 1023](1023-heatmap-data-url-keys.md) — the decision this corrects.
- [ADR 1022](1022-elements-chain-non-href-segments.md) — the source of the emitted-bytes over-claim.
- `posthog-js@1.379.2`: `lib/src/heatmaps.js` (`_capture` buffer keyed on `location.href`; `PERSONAL_DATA_CAMPAIGN_PARAMS`), `lib/src/utils/request-utils.js` (`maskQueryParams` rewrites named params only), `lib/src/posthog-core.js` (`mask_personal_data_properties: false` default; `before_send` applied to `$$heatmap`).
