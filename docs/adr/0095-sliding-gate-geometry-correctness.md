# ADR 0095 — Sliding-gate 3D geometry correctness + a geometry-position golden

**Status:** Accepted (2026-06-29 — core-hardening slice 1, the first of the
CODE-NOW core after the release-reality-check redirect). **Implementation:**
Implemented — `packages/fixtures/src/releases/sliding-gate.ts` (authored geometry
data), `packages/fixtures/src/sliding-gate.geometry.test.ts` (new golden),
`apps/web/app/configurator/scene/scenes.ts` (studio floor),
`apps/web/app/scene-lab/scene-lab-client.tsx` (real-fixture verification harness).
**BOM/price unchanged — goldens reproduce (`81451.5`, `81849.192`); I1–I11
untouched** (geometry placement is presentation off the same derivation, I4).

## Context

On a live review (Martin) the configurator's sliding gate "looked broken — models
floating in air, don't make sense, not Excel quality." The configurator v2 slices
(ADR 0091–0094) had polished the _presentation_ of a gate whose _authored geometry_
was wrong, and nothing caught it: the delta-0 corpus locks BOM/price, the renderer
tests lock cut angles + nesting, but **no test pinned where the 3D pieces actually
sit**, so internally-consistent-but-physically-wrong members shipped fully green.

We got eyes on the render (the `verify-3d-headless` skill — Playwright + SwiftShader
capture of the real fixture through the real `SceneCanvas`, then read the PNGs) and
cross-checked the authored geometry against the **working gates-MVP 3D render**
(`~/gates/packages/3d/src/sliding-gate.tsx`, the proven reference) and the **Excel**
(`~/gates/reference_files_unlocked/2026-PC_Samonosna_brana_*.xlsx`). Three defects,
all in the authored data, none in the engine/renderer/walker (those are correct):

1. **The suspension diagonal ascended into the sky.** `rotation Z = 180 − suspension_angle`
   points local +X up-and-left, so the brace rose to y≈2530 mm (≈1.2 m above the
   gate), attached to nothing — and inflated the scene AABB so the camera misframed
   the whole gate.
2. **The 6.5 m Nosník V floated as a full-width overhead beam** at `clear_height + 60`,
   overhanging both sides, attached to nothing. It is the LONGEST member (> railLength)
   — physically the ground carrier the cantilever leaf rides on, which must extend
   well past the opening; the proven gates-MVP render carries no overhead beam.
3. **The studio scene had no floor** (`ground: null`), so the gate hung over a grey
   void — the literal "floating in air" read, independent of (1)/(2).

## Decision

- **Diagonal descends.** `rotation Z` → `180 + suspension_angle`; the far end now
  lands at rail level inside the leaf (verified empirically and visually).
- **Nosník V seated at ground level** (`at.y` = `ground_elevation_mm`, was
  `+ clear_height_mm + 60`) as the ground carrier/track, extending toward the open
  side — no longer an overhead float.
- **Studio gets a real floor** (`ground: { colorHex, roughness }`, was `null`); the
  `ContactShadows` already seat on the gate's solid bottom, so it now reads as
  standing on a surface. Every scene now carries a ground.
- **A geometry-POSITION golden** (`sliding-gate.geometry.test.ts`) computes each
  piece's world endpoints (the same `at + R·[length,0,0]` transform the walker
  applies) and asserts the assembled envelope: no leaf piece rises above the clear
  height (catches BOTH historical floats — diagonal 2530, beam 1560), the diagonal
  descends to rail level, the exterior catch post is grounded+vertical, nothing sinks
  below the floor. **This is the systemic fix** — the missing guard that let wrong
  geometry ship green; it runs in the test gate.
- **The verification harness now drives the real fixture.** `/scene-lab?scene=sliding-gate`
  derives the real `sliding-gate@1` on the Excel-anchored U34 input through the same
  `deriveForUi` path the configurator uses (was a synthetic correct-by-construction
  gate that could never surface an authoring bug). Dev-only (404s in prod).

## Consequences / flagged (owed to later fidelity slices, NOT guessed here)

- **Diagonal cut angles** are authored `angle / 90`; the Excel řez for member D is
  **55 / 17,5**. A cut-list fidelity fix owed in the cut-angle slice (affects the
  dílna's mitre cuts — every member's B-column řez should be reconciled).
- **Catch-post height** is authored `clear_height + 400` (=1900); gates-MVP used
  `clear_height`. Confirm the real value with FIL.
- **Nosník V exact role/section/end-positions** are inferred (the proven gates-MVP
  render omits it); confirm against FIL / the Excel workshop diagram.
- **Box-fallback profiles** (`tower_post`, `top_guide_beam` carry no catalog
  `section` → render as 40×40 boxes) and the thin-profile / flat-material "not Excel
  quality" read are deferred to slice 2 (materials + environment).
- This is the first slice that changes authored release DATA (the v2 slices were
  pure presentation). I3 holds: the change is geometric placement only; BOM/price
  re-derive byte-identically.
