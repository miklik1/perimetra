# ADR 0073 — Procedural profile extrusion + the headless 3D verification harness

**Status:** Accepted (2026-06-24 — the HQ live-3D configurator build order; the
first 3D technique slice on the ADR 0072 brand foundation). **Shipped** (the
credibility foundation for the v1 configurator; ADR 0074–0077 — studio
lighting, finish swap, deviation surfacing, camera choreography, and the Part-B
hero layout — build on this).

## Context

The configurator already has a working R3F surface (ADR 0050/0051): a pure
walker (`scene-renderer.tsx`) over the engine's pure-data `Scene3D`
(`@repo/renderers`). But every piece drew as a **flat `<boxGeometry>`** — a
gate read as a stack of bars, not fabricated metal. The vault design direction
(`2026-06-23 Brand design extraction — Bombardier`, Part C technique 4) names
**procedural profile extrusion** as _the credibility foundation_: Perimetra
builds geometry from the `PieceProfile` the engine baked from the catalog
section (I4: L/U/T/rect_tube/flat/pane, `wMm`/`dMm`/`wallMm`), so a real
cross-section is the whole differentiator over Bombardier's pre-rendered raster.

Second problem: this box is **GPU-less** (software WebGL only) and the seat is
headless. A render regression (black environment, broken pipeline, wrong pixels)
is invisible to a unit test. The v1 3D slices need **eyes** — a way to actually
_see_ a render and confirm a material/lighting/geometry change looks right.

## Decision

**1. Procedural extrusion (`app/configurator/scene/profile-geometry.ts`).** A
`PieceProfile` becomes a `THREE.Shape` (rect_tube/flat/pane exact, with a hollow
`Path` only when the catalog gives a real `wall_mm` — never an invented one;
L/U/T as silhouettes), extruded along the piece length into a small-bevel solid
(`ExtrudeGeometry`). Extrude runs along local +Z, so the geometry is
`rotateY(π/2)`'d to map depth → the piece's local-X axis (origin at the axis
start, span `x∈[0, length]`) — matching `packages/renderers/src/shared.ts` and
what the box did. Key details:

- **Pure CPU** — `THREE.Shape`/`ExtrudeGeometry` build vertex buffers without
  WebGL, so the module is unit-testable in jsdom/node (the `frame.ts`
  discipline). The R3F walker only _attaches_ what this returns; it never
  measures (I4).
- **Module-level LRU geometry cache** keyed on `(shape, wMm, dMm, wallMm,
length)` — identical pieces share one GPU buffer; the cache **owns** the
  buffer lifecycle (disposes only on eviction; cap 256 ≫ any scene's distinct
  count), so `<mesh dispose={null}>`. Presentation fallbacks for absent dims
  (`?? 40`, thin `20` for flat/pane planks) are approximations, never written
  anywhere durable.
- **Box fallback preserved**: `custom` shape or no profile → `buildPieceGeometry`
  returns `null` and the walker draws the original `<boxGeometry>`, so nothing
  regresses for an unmodellable section. **The §6 `deviated` → amber override
  stays above the per-component palette** (unchanged from ADR 0051).
- `PieceProfile` is imported from **`@repo/engine`** (its origin — I4), matching
  every other app-land engine-type import, not via a `@repo/renderers`
  re-export (no new public surface).

**2. Headless 3D verification harness** (the eyes for this GPU-less box):

- `app/scene-lab/` — a **dev-only** route (`force-dynamic`, hard-404 in prod)
  that renders the configurator's _real_ `SceneCanvas` pipeline against a
  synthetic gate (`synthetic-scene.ts`: posts + rails + flat pickets, one piece
  flagged `deviated`) with no auth/api/engine stack — so a screenshot proves the
  render path end-to-end (extrusion, lighting, the §6 amber).
- `scripts/verify/capture-scene.mjs` — a Playwright (software-WebGL/SwiftShader)
  Chromium driver that loads `/scene-lab`, settles a few animation frames, and
  screenshots the canvas + a renderer report to the gitignored `.verify/` dir.
  Software WebGL renders correct **pixels** (only fps would be meaningless — and
  we capture no fps), so the visual is trustworthy. Reusable across every v1 3D
  slice (`verify-3d-headless`).

Lint/knip wiring: the `.mjs` harness runs outside the turbo graph and carries a
Playwright `page.evaluate` browser context, so `apps/web/eslint.config.js` gives
`scripts/**/*.mjs` the Node+browser globals and exempts `turbo/no-undeclared-env-vars`
(the e2e-block precedent); `knip.json` declares it an `entry` (the
apps/mobile asset-tool precedent).

## Consequences

- A gate now renders as real profiled sections — the premium the design
  direction promised, on the existing pure-data spine (no engine/contract
  change; the renderers stay presentation-free).
- The harness is the **reusable visual-verify path** for ADR 0074–0077; each
  render slice screenshots `/scene-lab` and is Read back before it's called
  done. **Render-taste passes owed to Martin** (copper shade, camera pacing, HDR
  look) are calibrated against those captures, not pre-decided.
- Recovered intact after an OOM killed the seat mid-slice; the dirty tree was
  unbacked — this ADR closes the dangling `ADR 0073` references the in-progress
  code carried. Gate green (web 117, goldens reproduce; no backend change).

Related: vault `2026-06-23 Brand design extraction — Bombardier` (Part C
technique 4 + the verify-3d capture lesson); ADR 0072 (the brand foundation);
ADR 0050/0051 (the R3F walker + `Scene3D` contract this extends); CORE_SPEC
§5/§6; `packages/renderers/src/shared.ts` (the axis convention).
