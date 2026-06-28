# ADR 0091 — Configurator exploded view (v2, the §9 reveal)

**Status:** Accepted (2026-06-28 — configurator v2, slice 1 of 3; the explode
half of the "exploded/section view 9" deferred by ADR 0077). **Implementation:**
Implemented (app-land only — `apps/web/app/configurator/scene/`; no
`model`/`engine`/`renderers`/`fixtures` change, I1–I11 untouched, goldens
reproduce).

## Context

ADR 0077 closed configurator v1 with "exploded/section view 9 deferred to v2".
"Exploded/section #9" and the §8 backdrops are **roadmap items, not CORE_SPEC
clauses** (§8 is "what tenants see", §9 is the monorepo map) — so v2 authors its
own ADRs rather than implementing a pre-existing data contract.

An exploded view is pure **presentation**: it separates the already-derived
pieces so a buyer/fabricator can read the assembly. It never re-derives geometry
(I4), never reads a config or release, and never touches the BOM/price (I1) — so
it belongs entirely in app-land, exactly like the finish (ADR 0075) and deviation
(ADR 0076) zustand slices. The renderer already exposes the only hook needed: the
`Scene3D` walker reads each piece's instance-local `at` directly, and every piece
id encodes its stable address (`<instanceId>/<partPath>/<pieceId>`, I9).

## Decision

- **A linear "bloom" off the piece-cloud centroid.** `pieceExplodeOffsets(scene)`
  (pure, in `explode-offsets.ts`, unit-tested in plain node) maps each piece id to
  a full-explode displacement: the vector from the instance's piece-cloud centroid
  to the piece's own axis midpoint, scaled by a `DEFAULT_EXPLODE_SPREAD` constant.
  Perimeter pieces travel far, central pieces barely move, so the original
  arrangement stays legible. The midpoint uses the SAME convention as
  `deviation-markers.ts` (origin + rotated half-length), so the two never drift.
- **The spread/distances are STRUCTURE, not a frozen value.** The spread constant
  and the iso camera distances are tuned against Martin's eye in the render-taste
  pass — they live as named constants, calibrated later, not pinned here.
- **An animated, scrubbable control.** A `useExplode` slice holds a discrete
  `target` (toggle 0↔1 or slider 0..1) and a live `factor`; an in-Canvas
  `ExplodeAnimator` damps `factor → target` each frame (dep-free
  `MathUtils.damp`, settles and stops touching state). The factor is **never a
  React subscription**: each piece registers its group with the renderer and one
  `useFrame` blooms every group's position by ref via
  `explodedPosition(piece.at, offset, factor)` — the `DeviationProjector`
  discipline — so animating the explode re-renders nothing (the walker reconciles
  only on scene/finish/highlight). The camera switches to a
  pulled-back isometric `exploded` pose keyed off the discrete `target` (so the
  pose never recomputes mid-transition) and stays user-interruptible (ADR 0077).
  A viewport `IconCluster` (the vocabulary the `IconButton` docstring already
  anticipated) carries the explode toggle + scrub slider.
- **§6 holds through the explode.** The world centre of a deviated piece is linear
  in `factor`, so `deviatedPieceCenters` gained an optional `offsets` map (the
  bloomed centres at `factor = 1`) and the projector lerps each marker between the
  assembled and bloomed centre by the live factor — the "no camera angle hides a
  deviated piece" guarantee (CORE_SPEC §6) survives the new mode with no drift.

## Consequences

- Zero schema / engine / renderer-package change: the whole feature is
  `apps/web/app/configurator/scene/` (a new pure `explode-offsets.ts` + a
  `explode.ts` slice + edits to the walker, canvas, camera poses, and the §6
  marker math). Goldens reproduce untouched; I1–I11 unaffected.
- Exploded OFFSETS are an app-land heuristic (the explode fork's chosen path);
  release-authored explosion recipes (a data-driven offset per part rule) stay
  deferred — they would need a schema addition + publish-gate clause and are not
  justified until a vendor needs bespoke separation.
- The visual calibration (spread amount, iso pacing, whether explode should be
  restricted off the colour step) is owed to Martin's eye — the standing
  render-taste CHECK (headless SwiftShader under-represents the look).

Related: ADR 0077 (the v1 deferral + camera choreography this reuses), ADR 0075
(finish slice — the presentation-state precedent), ADR 0076 / CORE_SPEC §6 (the
deviation guarantee preserved here), ADR 0050 / I4 (renderers stay pure — the
bloom is app-land, never a re-derivation). Next v2 slices: ADR 0092 (section /
cutaway), ADR 0093 (in-context preset scenes).
