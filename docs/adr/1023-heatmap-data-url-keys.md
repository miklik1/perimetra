# ADR 1023 — `$heatmap_data`'s object KEYS are URLs, and a key-reading walk cannot reach them

**Status:** Accepted (2026-07-19) — HQ-ruled default, Martin ratify queued (do-first doctrine, security lane). Extends [ADR 1013](1013-posthog-analytics-url-scrub.md).

**Provenance — a DOWNSTREAM find, paid back upstream.** Found by the adversarial review that `anyora-platform` ran over its own drain of this repo's analytics-sink work (anyora ADR 0076, `83c1f32`). The defect is **this repo's**: it has been present since ADR 1013 shipped the walk.

## Context

Every rule in `analytics-scrub.ts` has the same shape: it reads a **key** and rewrites a **value**. `scrubEntry(key, value)` dispatches on the key; the object branch recurses as `scrubEntry(k, v)`, restoring real keys for nested objects. The walk is built on the assumption that keys are names and values are data.

`$heatmap_data` breaks that assumption. PostHog's heatmaps buffer is keyed by `location.href` and flushed as:

```js
capture("$$heatmap", { $heatmap_data: buffer });
```

so the property is an object whose **keys are page URLs, with their querystrings**. The SDK masks that href only when `mask_personal_data_properties` is set, which **defaults to false**.

The result is this module's own headline leak class — an arbitrary `?search=<surname>`, PII that no value-shape pattern recognises — shipping in the clear, in a position no rule in the module could reach. The value under that key (the interaction buckets: coordinates and counts) was walked correctly and was never the problem. The key was never a candidate for rewriting at all.

**Two things make this worse than its raw likelihood suggests.** Heatmaps are enabled from the PostHog UI with no code change, so the event can begin flowing into a repo that has shipped, reviewed and gated nothing new. And the leak is invisible to review by inspection of the rules, because every rule _is_ correct — the gap is in the shape of the traversal, not in any rule's logic.

## Decision

**The `$heatmap_data` key is query-dropped and its buckets are merged.**

```ts
if (key === "$heatmap_data") {
  const merged: Record<string, unknown> = {};
  for (const [href, bucket] of Object.entries(value)) {
    const safeHref = dropUrlQuery(href);
    const scrubbed = scrubEntry(href, bucket);
    const existing = merged[safeHref];
    merged[safeHref] =
      Array.isArray(existing) && Array.isArray(scrubbed) ? [...existing, ...scrubbed] : scrubbed;
  }
  return merged;
}
```

**Merging is the load-bearing half of this decision, not a refinement.** Dropping the query is exactly what collapses distinct keys onto one: `/clients?search=Novakova` and `/clients?search=Svoboda` both become `/clients`. Built the obvious way — `Object.fromEntries(entries.map(...))` — the later key silently wins and every interaction recorded on the first page is destroyed. **A redaction rule must not also become a data-loss rule**, and a redaction rule that quietly discards analytics data is one that gets ripped out the first time someone notices the numbers are wrong. Non-array bucket values are not merged (nothing in the SDK produces them); the later value wins, which is what would have happened anyway.

The rule is keyed on the exact property name rather than on "does this object have URL-shaped keys", because a shape heuristic over every object in the bag would rewrite legitimate map-like custom properties a project defines, and this module's whole posture (ADR 1013) is to stay narrow rather than to guess.

## Consequences

- **The last position in this sink where a querystring could sit unscrubbed is closed.** Keys, values, array elements, nested objects, and the serialized `$elements_chain` twin are now all covered.
- **The generalisable lesson, which is the reason this got its own ADR rather than a line in ADR 1022:** _a redaction walk that reads keys and rewrites values is structurally blind to PII that IS the key._ This is a traversal-shape defect, not a missing pattern — no addition to a key list or a value pattern would have found it. When auditing any scrubber, the question "can this thing reach a key?" must be asked separately from "does it cover this field?". Distilled to the vault as its own finding note.
- **A cheap follow-up for any derived repo that enables heatmaps:** confirm the bucket contents themselves stay coordinate-and-count only. This ADR walks them, but the walk is only as good as the SDK's shape staying what it is today.
- **Fleet exposure.** Every repo stamped at or after the ADR 1013 commit carries the blind walk and must drain this. `anyora-platform` already has it; `web-native-skeleton` is fixed in lockstep with this commit as its ADR 1016.

## Sources

- [ADR 1013](1013-posthog-analytics-url-scrub.md) — the analytics sink and the key-reading walk this corrects.
- `anyora-platform` ADR 0076 (`83c1f32`) — the downstream fix this pays back.
- `posthog-js` heatmaps: buffer keyed by `location.href`, flushed as `$heatmap_data`; `mask_personal_data_properties` defaults to `false`.
- Vault: `A redaction walk that reads keys and rewrites values is blind to PII that IS the key`.
