# ADR 0052 — Site canvas: the generated surface at site scope

**Status:** Accepted (2026-06-13). Implemented in step 6 slice 2 (CORE_SPEC §10).

## Context

CORE_SPEC §8 promises, alongside the per-instance configurator (ADR 0051),
"the site canvas (place, connect, drag instances; 3D playground) — the same
generated surface at site scope." Steps 4–5 built the site graph
(`deriveSite`, ADR 0049) and the renderers off it (`buildScene`/`buildSitePlan`,
ADR 0050); slice 1 built the single-instance configurator and proved its 3D
viewport already consumes the `(Site, SiteResult)` contract for a degenerate
one-instance site (I11). Slice 2 is the multi-instance editing surface: a user
places vendor releases, drags their poses, connects their ports, assigns
stepped terrain, and watches the aggregate BOM/price/3D derive live.

## Decision

1. **A new `/site` surface that reuses slice 1 wholesale.** `apps/web/app/site/`
   embeds `Wizard`, `ParamField`, the R3F `SceneViewport`, `resolveUi`, and the
   interim `configurator/products.ts` release source unchanged — only the
   site-scope shell, the 2D plan editor, and the aggregate results panel are
   new. `/configurator` (one product, deeply) and `/site` (a project of
   connected instances) are the two distinct intents §8 names; they stay
   separate surfaces for now. Their shared presentation (BOM table, totals grid,
   issue list) is **convergence debt** — the money formatter and issue list are
   already extracted (`apps/web/lib/format-money.ts`, `site/issue-list.tsx`);
   the rest converges when project persistence lets `/configurator` become a
   one-instance `/site`.

2. **Two truths, kept apart, so editing never dead-ends.** The compute layer
   (`site/derive.ts`) runs one `deriveSite` per edit. The **aggregate**
   (BOM/price/3D/whole-site plan) renders only when the site is valid — an
   invalid site has no geometric truth to draw (I5), the established slice-1
   "placeholder + typed issues" behaviour. The **per-instance footprints**
   reuse each instance's already-derived geometry from `result.instances[id]`
   (wrapped in a degenerate one-placement site for the renderer — no
   re-derivation) so the plan stays selectable and draggable even while a
   too-steep terrain step or an incompatible pairing invalidates the whole
   site. This is the only way "drag the bad instance apart to fix it" can work.

3. **The plan editor is app-land presentation; geometry stays in the
   renderers (I4).** The SVG plan draws `buildSitePlan` outlines and connection
   lines between **engine-derived port anchors** (the renderer's `toPlan`
   transform, now exported, is the single plan-coordinate authority). Drawing a
   line between two known anchors is a UI affordance, not geometry
   recomputation. Pointer→plan math goes through the SVG CTM (and no-ops when
   absent, e.g. jsdom). Poses store integer arc-minute rotation; the rotate
   control steps 5400′ (90°), never float degrees (I10).

4. **The canvas cannot author an invalid connection (I7).** Only ports whose
   kinds are **mutually** compatible and that are both free are offered as
   targets; a used port is inert (it already joins one neighbour). The connect
   gesture's source is always a free port or nothing. The engine remains the
   authority — the UI just never advertises a connection the engine would
   reject. Terrain elevation is written only through `SitePlacement.
terrainSegmentId` → the release's `elevationParam` (the one input gate, I7);
   the canvas never sets the elevation parameter directly.

5. **Per-line BOM money crosses the I10 boundary.** `SiteBomLine` gains
   `totalPriceMoney: MoneyString` (canonicalised by `toMoneyString` at
   aggregation, like `SiteResult.money`); the raw `totalPrice: number` stays
   internal-only for the sum. No per-line float reaches display or future
   serialisation.

6. **@repo/fixtures seeds the page** (⌛ expires with project persistence):
   `site/initial.ts` opens on the golden three-instance `steppedSite`, whose
   aggregate the delta-0 harness locks at `money.total === "129891.504"` (and
   `"130241.504"` with the fence joint removed — I6) — asserted through the
   canvas's compute path in the web test suite.

## Consequences

- The selected instance is derived once more than the aggregate needs (its form
  `Scope` is not on `SiteResult`) — the same split the configurator uses; a
  bounded extra derivation, noted in `site-client.tsx`.
- Every edit (including each drag frame) re-derives the whole site. Pure and
  fast at this scale; for large sites the aggregate could defer to drag-end
  while footprints update live — a documented, deferred optimisation.
- Connection-line precision uses port anchors when an end has derived, falling
  back to the footprint centroid then the raw pose origin, so a not-yet-valid
  end still draws a line to fix or remove.
- `InstanceUi.result` is optional: an instance the engine skipped (e.g. an
  elevation conflict) has no per-instance result, and the site panel surfaces
  that as a typed site issue rather than crashing the card (I5).
- Deviation-override UX (needs quote scope) and the issue-key i18n catalog
  remain follow-ups, as in ADR 0051.
