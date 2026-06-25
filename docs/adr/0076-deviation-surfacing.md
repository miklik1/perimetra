# ADR 0076 — Deviation surfacing: emissive highlight + out-of-frustum edge markers

**Status:** Accepted (2026-06-25 — the HQ live-3D configurator build order, the
fourth 3D technique slice). **Shipped** on ADR 0072–0075; ADR 0077 (camera +
5-step wizard) completes v1.

## Context

CORE_SPEC §6 makes artifact-override deviations a **correctness invariant**, not
decor: "the salesperson is never blocked; the workshop always sees what
deviated; the system is never silently wrong." The 2D drawing already renders a
mandatory `DrawingFlag` per deviation; the live 3D scene only carried a
`ScenePiece.deviated` boolean that the renderer ambered. Two gaps:

1. In a busy gate a single amber piece can be lost among many.
2. **A deviated piece can be off-screen** — orbit away and it is hidden, which
   §6 forbids ("no surface can hide a deviated element"). Bombardier has no
   analog; this is a Perimetra invariant (vault design note, technique 8).

## Decision

Two independent mechanisms, both app-land R3F (the engine/contract is unchanged —
the boolean and the `PartDeviation` list it already emits are the only inputs):

- **Highlight toggle (emphasis).** A `useDeviation` zustand slice; when ON,
  deviated pieces go **emissive amber** (`emissiveIntensity 0.55`) and the rest
  **desaturate** to a muted grey, so the deviation pops. A viewport `IconButton`
  (the brand control vocabulary) drives it; a `Badge tone="deviation"` shows the
  count. Both appear only when something deviates.
- **Out-of-frustum edge markers (the §6 guarantee — always on).** Independent of
  the toggle: for every deviated piece, each frame, `vec3.project(camera)`
  (in-canvas `DeviationProjector`) → a pure `placeEdgeMarker` (`deviation-markers.ts`)
  decides on/off-screen and, when off-screen (incl. **behind the camera**, the
  `z > 1` mirror case), clamps the direction to a margin ring so a DOM marker
  rides the viewport edge pointing at the piece. **No camera angle can hide a
  deviated piece.**

The deviation amber is unified on the brand **`--color-deviation` `#f59e0b`**
token (was an ad-hoc `#e07b39`) so the mesh, the badge, and the DOM rows agree,
and it sits on its OWN plane from the copper UI accent (Direction §2).

**Implementation choices:**

- The markers are a **ref-driven DOM overlay**, not drei `<Html>`: drei `<Html>`
  positions at a point's projection (an off-screen point lands off-screen, which
  defeats the guarantee), so edge-clamping needs custom positioning anyway. The
  projector mutates each marker's `style` by ref every frame — **zero per-frame
  React re-render**. (This realises the note's `<Html>` intent more directly.)
- The **pure half is unit-tested** (`deviation-markers.test.ts`, 8 cases — gate
  covered, no WebGL): world-centre transform order, on/off-screen detection,
  edge clamping into the viewport, and the behind-camera case. The **integration**
  is an e2e (`e2e/deviation.spec.ts`): `/scene-lab?cam=away` points the camera
  away so the deviated piece is genuinely behind the frustum and asserts a marker
  is visible — plus a companion test that the marker stays hidden when the piece
  is in frame (no permanent chrome).
- `DeviationPanel` (DOM) renders one row per `PartDeviation` (field, original→value,
  reason) — the human-readable mirror of the same source the 2D `DrawingFlag`
  carries. Reused in the wizard Summary (ADR 0077). The viewport count badge
  counts deviated **pieces** (what is marked); the panel counts **deviations**
  (parts) — different units for different surfaces, by design.

## Consequences

- §6 is now enforced in 3D: a deviation is impossible to hide at any angle, and
  emphasis-able on demand. The happy-path configurator (no quote-scope overrides)
  shows nothing — the surface is dormant until a deviation exists, then
  unmissable.
- **Render-taste pass OWED to Martin** (not a blocker): the marker glyph/size and
  the desaturated-grey value are calibrated against a GPU render; the
  amber-on-wood base contrast is the weakest base case (both warm) but the
  highlight mode resolves it.
- No engine/contract/schema change. Full gate green (web 127 incl. the new pure
  tests, knip; goldens 81451.504 / 129891.504 reproduce); 2 e2e specs pass.

Related: CORE_SPEC §6; vault `2026-06-23 Brand design extraction` (technique 8 +
Direction §2); ADR 0072 (`--color-deviation` token); ADR 0073 (the pieces);
`drawing2d.ts` (the 2D `DrawingFlag` mirror); `verify-3d-headless`.
