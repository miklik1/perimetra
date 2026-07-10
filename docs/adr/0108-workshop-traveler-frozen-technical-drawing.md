# ADR 0108 — The workshop traveler: freeze the technical drawing into the quote snapshot, print it price-blind

**Status:** Accepted (2026-07-10). Implemented. Closes CAR-124. Builds on ADR 0101
(workshop production view), ADR 0102 (the drawing emitter) and ADR 0087 (the
browser-print document seam).

## Context

The geometry source of truth exists so that a fabricator on the shop floor holds a
printable 2D drawing. That chain had a missing link nobody had recorded.

Two drawing pipelines coexisted. `buildWorkshopDrawing` (ADR 0077,
`packages/renderers/src/drawing2d.ts`) is what every quote snapshot actually froze
and what `/quotes/:id/production` rendered: flat quads whose only dimensions are
`overall.width` and `overall.height`. `buildTechnicalDrawing` (ADR 0102,
`packages/renderers/src/drawing/`) is the emitter that produces feature-bound
dimensions, chain/pitch ladders, section cuts and member callouts — and it had
**zero consumers outside its own tests**. Nothing froze it, and no component
rendered it. ADR 0102's own text asserts "the spec freezes into the quote snapshot,
so a re-derived historical quote reproduces byte-identical drawings (I3)"; that
sentence described an intent, not the code.

The consequence: a fabricator could only ever be handed a bounding box with a BOM.
Nothing was printable at all — the sole print surface in the app was the priced
nabídka (ADR 0087), which the workshop must never see.

## Decision

**1. Freeze the technical drawing at issue, as a top-level snapshot field.**
`artifactsOf` — the single frozen-artifact builder shared by `issue()` and
`verifyReproducibility()` — takes the per-instance `DrawingSpec` (read off each
release's immutable `drawing` field) and emits
`technicalDrawings: Record<instanceId, TechnicalDrawing>`.

It is a **sibling of `drawings`, never nested inside it.** `drawings` is compared
by a deep-equal in `verifyReproducibility`; nesting a new artifact there would make
every quote issued before this slice mismatch, retroactively breaking I3 on
historical data. The check for `technicalDrawings` is therefore added **only when
the frozen snapshot carries the field** — the expand half of expand/contract. A
pre-slice quote reproduces on the artifacts it actually froze; a post-slice quote
compares the drawing and catches drift.

**2. Spec rows are frozen at issue, and their values never touch the price layer.**
`specRows: Record<instanceId, {key, label, value}[]>` is captured from the release's
§8 `UiSpec` labels (domain wording is release DATA, not app i18n) valued from the
frozen `ConfigInput`. Freezing keeps `getProduction` a pure snapshot read — it never
loads a release, never re-derives (the ADR-0101 contract).

The value scope is deliberately **not** the engine's `buildScope`. `buildScope`
seeds itself with `priceScope(prices)`, so a parameter whose `defaultExpr` reads a
`price.*` key resolves to a price-table number — which would then print verbatim on
the price-blind sheet. (`sliding-gate`'s `manufacturing_hours` already defaults to
`price.manufacturing_multiplier`, and the sibling `price.manufacturing_rate` is a
CZK/hr figure.) `specValueScope` builds parameter defaults and the frozen input with
**no price layer at all**, so a price-dependent default cannot resolve: `evaluate`
throws on the unknown reference and the parameter is simply absent, rendering "—".
Absence, never a masked money value — the same structural discipline as the ADR-0101
allowlist. A regression test pins it: with the price layer in scope the sheet printed
`790`.

Spec rows are **not** an I3 check. Like the frozen `customer`/`supplier` blocks they
are a captured fact off immutable release data, not a re-derived engine artifact.

**3. The projection is an allowlist, and the schema is structured.** `toProduction`
copies `technicalDrawings` through `productionSafeTechnicalDrawing` (the same
field-by-field discipline as `productionSafeDrawing`), projects `specRows`, and
derives `dimensionRows` (`{id, label: label ?? id, valueMm}`) from the drawing's
dimension and chain annotations. All three are hand-mirrored as **structured** zod
schemas on `quoteProductionSchema` — never `z.unknown()` — so a smuggled money field
fails closed at serialization rather than silently shipping. All three are optional
and simply absent for a pre-slice quote.

**4. Dimensions carry a human label.** `DimensionRule`/`ChainRule` gain an optional
`label` (Czech display text, release data), threaded through the annotator to
`PlacedAnnotation.label`. Absent label ⇒ consumers show the rule `id`. The publish
gate rejects an authored-but-blank label. The emitter's un-authored fallback dims
carry Czech labels too, so a release with no `DrawingSpec` still prints
`Celková šířka` rather than the identifier `overall.width` on a Czech sheet.

**5. Presentation is app-land.** `TechnicalDrawingSvg` is the first renderer for
`TechnicalDrawing`: ink-on-white, dash-pattern role encoding (never colour alone),
`vector-effect="non-scaling-stroke"` so hairlines survive print scaling, a viewBox
framed on the **union of edges and annotation geometry** (dimension lines sit outside
the part and would otherwise clip), and a `nominalDepth` section cut drawn dashed and
un-hatched with an `orientační hloubka` caption — an invented profile depth would be a
lie about the part. `/drawing-lab` is the checked-in eyes-on route the existing
`capture-drawing.mjs` already expected.

**6. The traveler prints through the browser.** `/quotes/:id/production/traveler`
consumes the existing, already price-blind `GET /v1/quotes/:id/production` — no second
endpoint, no second data path — and lays out, per instance: identity header, the front
elevation with its section views, labeled spec rows, labeled dimension rows, the BOM
grouped by category (quantities only), and the cut list. `window.print()`, zero PDF
dependency (ADR 0087), `break-inside: avoid` on the long tables.

## Consequences

- **Layout constants now scale with the drawing.** `dimsolve`'s lane offsets were
  absolute millimetres (`BASE_GAP=140`, `LANE_STEP=100`) while consumers size type as a
  fraction of the drawing's span. On an 8 m fence run the captions stacked on top of one
  another and the sheet was unreadable. Lanes and the label-collision clearance are now
  span-proportional with the old constants as the floor, so a small part places exactly
  as before. The branka golden moved by exactly one number — `member.D`'s label anchor,
  nudged clear of `member.B`.
- **A shared `PrintSheetStyle`.** Both printable documents now share the inline `@page`
  block, which also fixes a live bug in the shipped nabídka: the theme's `.dark` class
  survives into the print DOM, and browsers honour a printed element's `color` while
  suppressing its background — so a sheet printed from a dark-themed browser was
  near-white ink on white paper. Print now pins the light token values.
- Pre-slice quotes degrade honestly: no technical drawing, no spec rows, no dimension
  rows — the traveler renders what exists rather than throwing.
- The section view is exact only where a member's axis is parallel to the section-plane
  normal (true of every current family), and hidden-line removal remains a silhouette
  floor — both inherited from ADR 0102, unchanged here.
- ADR 0102 stays **Proposed**. Its flip to Accepted is Martin's eyes-on sign-off, which
  now has a checked-in surface (`/drawing-lab`) to be performed against.

## Sources

- CORE_SPEC §1 (I3 re-derivability, I4 renderers derive, I5 honest failure), §5
  (drawings as pure data off the geometry SoT), §8 (UiSpec labels are release data).
- ADR 0101 (price-blindness is an allowlist projection + a structured schema), ADR 0102
  (the emitter), ADR 0087 (browser print, zero PDF dependency), ADR 0056 (workshop role).
