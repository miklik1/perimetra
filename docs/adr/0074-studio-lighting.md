# ADR 0074 — Studio lighting: procedural Lightformer IBL + contact-shadow grounding

**Status:** Accepted (2026-06-24 — the HQ live-3D configurator build order, the
second 3D technique slice). **Shipped** (the #1 premium carrier on the ADR 0072
brand foundation + the ADR 0073 extrusion; ADR 0075–0077 build finish-swap,
deviation surfacing, and camera choreography on this).

## Context

After ADR 0073 the gate renders as real profiled sections, but under flat
ambient + plain directional light it reads dull and **floats** — no grounding,
no material life. The vault design direction (`2026-06-23 Brand design
extraction`, Part C technique 2) names **studio IBL + PBR + a soft contact
shadow** as _the single biggest premium carrier_ — the thing that makes the live
render read like Bombardier's baked studio raster.

The load-bearing constraint (already documented in `scene-canvas.tsx`): the
strict CSP blocks drei's `<Environment preset>` HDR CDN. The Direction's decided
answer (§5) was "self-host a small `.hdr`," but that means sourcing + committing
a binary asset and adding a CSP origin.

## Decision

**Procedural studio IBL via drei `<Lightformer>`s** — a five-light rig (soft
top-front key, two cool side fills, a back rim that picks out the extrusion
bevel, a faint ground bounce) inside `<Environment resolution={256} frames={1}
background={false}>`. This renders to an offscreen cube (so it's **CSP-clean** —
no external fetch) and stays **invisible** (`background={false}`), so the
warm-grey field reads behind the gate. It achieves the decided _invisible studio
IBL_ with **no binary HDR asset and no CSP change** — a cleaner v1 than a sourced
`.hdr`. (A real HDRI stays the path for the §8 _visible_ in-context backdrops,
which are a separate later mechanism — this slice is the _lighting_, not the
_scenery_.)

On top of the IBL:

- **One warm key `directionalLight`** (kept per the note) for crisp directional
  modelling + specular pop on the profile edges, positioned off `frame.radius`.
- **`<ContactShadows>`** grounds the gate on the scene floor. `frame.ts` gains
  `groundY` (the world-space AABB min-Y) so the shadow plane sits at the gate's
  base, not a guessed offset — a pure addition, unit-tested (`frame.test.ts`,
  new; `frame.ts` was previously untested). The CAD `<Grid>` is **removed** in
  this hero canvas (the note: contact shadows replace the grid in hero mode).
- **Brand-field background** (`#ededed` = `--color-field`, was a cooler
  `#dde3ea`) + tone-mapping exposure trimmed `1.4 → 1.0` now that the IBL adds
  fill. `OrbitControls` stays (the controller swap is ADR 0077's concern).

The synthetic `/scene-lab` harness (ADR 0073) renders the same `SceneCanvas`, so
the studio look was headless-captured and Read before shipping.

## Consequences

- The live configurator now carries the studio premium with **zero external
  assets** and no CSP edit — the whole rig is code, tweakable in one file.
- **Render-taste pass OWED to Martin** (not a blocker): the exact metal
  (metalness/roughness), key/IBL intensities, and the copper-vs-amber read are
  calibrated against a _GPU_ render — SwiftShader (the GPU-less verify box)
  under-represents specular/reflection, so the captured look is a floor, not the
  ceiling.
- A ground contact shadow is inherently **thin** for a near-planar vertical gate
  (it touches the floor along a line); it reads fuller on real gates with frame
  depth. Acceptable for v1; revisit if planar products need a different
  grounding cue.
- No engine/contract/schema change — all app-land R3F. Gate green (web 119,
  goldens reproduce).

Related: vault `2026-06-23 Brand design extraction` (Part C technique 2 + §5/§8);
ADR 0072 (brand field token); ADR 0073 (the extrusion this lights);
`verify-3d-headless` (the capture path).
