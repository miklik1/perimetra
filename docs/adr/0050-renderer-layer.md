# ADR 0050 — Renderer layer: derived piece geometry, pure data renderers

**Status:** Accepted (2026-06-12). Implemented in step 5 (CORE_SPEC §10).

## Context

CORE_SPEC §5/§9 require every output — BOM, price, cut list, 3D scene, 2D
drawings — to derive from the one assembly/site graph (I4: no renderer ever
recomputes geometry from raw config). Through step 4 a `Part` carried only
BOM facts (component, quantity, rolled-up length); renderers need physical
pieces with transforms and cut angles, and the site plan needs port
positions. The spec sketched `geometry`/`repeat` on PartRule and `anchor` on
PortDef but left the operational shape open.

## Decision

1. **A BOM line and its physical pieces are different truths.** PartRule
   gains `geometry: GeometryRule[]` — each rule a KEYED group of pieces
   (`key` an identifier; piece ids `<key>` / `<key>[i]`, I9) with expr-driven
   `length`, `at` [x,y,z], `rotation`, `cuts`, and an optional
   `repeat: {count, var}` that binds `var` into the rule's scope (fill
   lamella i at `100 + i * spacing`). The sliding gate's `frame.lprofile`
   bills rolled-up meters but cuts five distinct pieces — the BOM exprs and
   delta-0 goldens are untouched by geometry authoring. The spec's
   part-level `repeat` (1..n Parts per rule) stays deferred until a model
   needs distinct per-index BOM lines.

2. **The engine bakes catalog facts onto parts.** At derivation the resolved
   component's section profile (`shape`, w/d/wall) and `stockLength_mm` land
   on `Part.geometry`; declared port anchors evaluate into
   `DerivationResult.anchors`. Renderers therefore take **(Site, SiteResult)
   and nothing else** — I4 enforced at the type level: no renderer signature
   accepts a config, a release, or the catalog.

3. **Angles: authored in decimal degrees, emitted as integer arc-minutes**
   (I10) — piece rotations and mitre cuts alike (35° cut → 2100). Renderer
   trigonometry is exact at quarter turns, so axis-aligned geometry (every
   post and rail) keeps integer coordinates; only genuinely angled pieces
   (the suspension diagonal) carry IEEE floats (deterministic per ADR 0045).

4. **Renderers are pure data emitters** in `packages/renderers`
   (renderers → engine → model in the ESLint DAG):
   - `buildCutList` — pieces grouped by component, identical cuts merged,
     deterministic first-fit-decreasing nesting into catalog stock lengths;
     kerf is an explicit option (default 0) until fabrication profiles carry
     sourced kerf data; a piece longer than its stock bar lands on
     `oversize`, never dropped or mis-nested (I5).
   - `buildScene` — instance groups under site poses (plan x→X, plan y→Z,
     pose rotation about Y), pieces local; consumers nest transforms, never
     compose them.
   - `buildWorkshopDrawing` — front-elevation quads (a 35° diagonal stays a
     slanted bar, not a bbox), overall dims, and the MANDATORY deviation
     flags (CORE_SPEC §6): every artifact override renders on the drawing.
   - `buildSitePlan` — top-view outlines under poses, connections drawn
     anchor-to-anchor with the shared element marked (I6), terrain segments
     annotated with their instances.
     PDF/SVG/R3F are presentation ADAPTERS in app land (step 6): they draw
     these shapes and never measure. The deprecated `~/gates` R3F walker is
     the port reference for the 3D adapter.

5. **Sharing consumption is render-wide (I6).** The consumer's element
   vanishes from scene, plan, and saw exactly as it vanished from the BOM —
   all four read the same `SiteResult.sharing` set.

6. **Invalid results refuse to render (I5).** Every builder throws on
   `isValid: false` — an invalid site has no geometric truth; no partial
   drawing ever ships.

## Consequences

- Proven on the step-4 corpus: the gate cuts 48 pieces, each fence 31
  standalone / 30 connected; the cut list cuts exactly 4 fence posts (the
  BOM golden at the saw); fenceB's pieces sit 150 mm up off its terrain
  segment; the diagonal's mitre reads 2100 arc-min.
- Artifact overrides flag at PART level on the drawing; patching individual
  PIECE geometry (one cut of a repeated group) is deferred until the
  workshop needs it — the §6 contract (deviation always visible) holds
  today via the flag.
- Accessories (motor, kits, rollers) are BOM-only until a drawing needs
  them; geometry is authored per part, never invented wholesale.
- `joints` stay reserved (CORE_SPEC §3); piece geometry carries the current
  renderers without joint records.
- Stock lengths in the fixture catalogs are industry-standard 6 m pending
  FIL confirmation; a component without `stockLength_mm` simply gets no
  nesting — never a guessed bar.
