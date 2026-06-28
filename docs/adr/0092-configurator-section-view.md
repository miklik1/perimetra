# ADR 0092 — Configurator section / cutaway view (v2, the §9 reveal — part 2)

**Status:** Accepted (2026-06-28 — configurator v2, slice 2 of 3; the section
half of the "exploded/section view 9" deferred by ADR 0077). **Implementation:**
Implemented (app-land only — `apps/web/app/configurator/scene/`; no
`model`/`engine`/`renderers`/`fixtures` change, I1–I11 untouched, goldens
reproduce).

## Context

The explode slice (ADR 0091) opened the assembly out; the section view does the
complementary thing — slices through it so the **extruded profiles reveal their
hollow cross-sections** (the rect-tube walls, the L/U/T shapes). Like every
configurator viewport mode it is pure presentation: a three.js clipping plane
discards fragments on one side of a cut. It re-derives nothing (I4), never reads
a config/release, never touches the BOM/price (I1).

Per the v2 plan's design fork, this slice is a **clipping plane only** — NOT a
2D cross-section-drawing renderer (that would be a new renderer + a typed
plane-spec input, a heavier separate slice; deferred).

## Decision

- **A world-space clipping plane, per-material on the pieces.** The Canvas runs
  with `gl.localClippingEnabled = true`; each piece `meshStandardMaterial` carries
  the section `clippingPlanes` + `clipShadows`, so the cut applies to the gate
  pieces only — the studio `<ContactShadows>` and IBL stay whole (the per-material
  path the fork preferred over a global `gl.clippingPlanes`).
- **The cut geometry is pure + tested.** `sectionPlane(frame, axis, position)`
  (`section-plane.ts`, no three.js) maps the 0..1 `position` across the world AABB
  (`frameScene` now also returns the raw `min`/`max` corners) and returns
  `{ normal, constant }` — the half-space that KEEPS the lower-coordinate side
  (three.js keeps `normal·p + constant ≥ 0`). Unit-tested per axis + clamp.
- **One stable `Plane`, mutated imperatively.** A single `THREE.Plane` is mutated
  each frame by an in-Canvas `SectionPlaneRig` off `useSection.getState()` — never
  a React subscription — and the `clippingPlanes` array passed to the materials is
  a STABLE ref that switches only on the on/off toggle (`[plane]` ↔ empty). So an
  axis/position SCRUB updates the clip live with zero walker re-render.
- **`SceneRenderer` is now `memo`'d.** This is the load-bearing render-discipline
  fix: the canvas re-renders on every explode/section scrub (it subscribes to the
  control state for the UI), but the walker's props (`scene`, `offsets`,
  `clippingPlanes`) are stable across a scrub, so the memo skips reconciling the
  piece tree. Finish/deviation still re-render the walker — those are internal
  store subscriptions inside `SceneRenderer`, which `memo` does not block.

## Consequences

- Zero schema / engine / renderer-package change — the whole feature is
  `apps/web/app/configurator/scene/` (`section.ts` slice + pure `section-plane.ts`
  - `frame` gaining `min`/`max` + the canvas/walker wiring). Goldens reproduce;
    I1–I11 unaffected.
- The cut DIRECTION (keep lower half), the default axis (X), and the position
  range (full 0..1) are render-taste defaults — calibrated against Martin's eye,
  not pinned. A 2D section-cut DRAWING and release-authored section presets stay
  deferred.
- Section + explode compose (both are app-land presentation); the clip plane is
  computed off the assembled AABB, so a simultaneously-exploded-and-sectioned
  scene cuts at the assembled position — an acceptable edge of two stacked modes.

Related: ADR 0091 (the explode slice + the imperative/`memo` render discipline
this extends), ADR 0050 / I4 (renderers stay pure — the clip is app-land),
ADR 0074 (the studio shadow/IBL the per-material clip leaves whole). Next: ADR
0093 (in-context preset scenes).
