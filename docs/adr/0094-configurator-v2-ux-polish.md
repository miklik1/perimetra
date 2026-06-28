# ADR 0094 — Configurator v2 UX polish (explode reads as an assembly)

**Status:** Accepted (2026-06-28 — configurator v2 render-taste pass; refines
ADR 0091/0092). **Implementation:** Implemented (app-land only —
`apps/web/app/configurator/scene/`; no `model`/`engine`/`renderers`/`fixtures`
change, I1–I11 untouched, goldens reproduce).

## Context

On the live render-taste review (Martin), configurator v2 landed in the right
direction but the **explode "mostly didn't make sense"** and the **slider
controls didn't align with their toggle icons**. The features stay (still the
configurator playground) — this is a polish, not a re-scope.

The explode complaint was a real defect, not just taste: ADR 0091's bloom moved
every PIECE independently off the assembly centroid, so a flat gate's bars
scattered in-plane instead of separating like an assembly — pieces of the same
welded frame flew apart from each other.

## Decision

- **Explode blooms BY PART, rigidly.** `pieceExplodeOffsets` now groups pieces by
  their `partPath` (the stable middle segment of the I9 piece id) and gives every
  piece of a part ONE shared offset — the vector from the assembly centroid to the
  PART's centroid, scaled by the spread. So the frame travels as a unit, the
  infill as a unit, the lock as a unit; perimeter parts travel far, central parts
  barely move. It reads as an exploded assembly, and the offsets still sum to zero
  (a balanced bloom). A single-part assembly no longer explodes (nothing to
  separate) — the correct behaviour. §6 is unaffected: the offset map stays
  per-piece keyed, so the deviated-marker lerp is unchanged. Because a single-part
  release blooms to nothing, the explode toggle is **disabled** (and the camera
  never pulls to the iso pose) when no part can separate — no dead "camera moves,
  gate stays assembled" toggle (caught in the adversarial review).
- **Controls align with their toggles.** The viewport mode cluster's scrub
  controls now each sit in their OWN fixed `h-8` row (matching the `size-8`
  toggle) at `items-center`, present-but-empty when that mode is off — so the
  explode slider lines up with the explode toggle and the section row with the
  section toggle, instead of the section row sliding up under the explode toggle.

## Consequences

- Zero schema/engine/renderer change — `explode-offsets.ts` (the grouping) + the
  `scene-canvas.tsx` overlay layout. Goldens reproduce; I1–I11 unaffected.
- The grouping is the render-taste refinement ADR 0091 anticipated ("an app-land
  heuristic … the spread is tuned in the render pass"). The spread constant, an
  optional depth-layer stagger, and the section default axis remain tunable — the
  section's X/Y/Z scrubber is acknowledged playground (kept by Martin's call), not
  a daily-use control.

Related: ADR 0091 (the explode slice this refines), ADR 0092 (the section slice
the aligned controls also serve), ADR 0075 (the presentation-state precedent).
