# ADR 0075 — Finish / colour / material swap (live-mesh, presentation-only)

**Status:** Accepted (2026-06-25 — the HQ live-3D configurator build order, the
third 3D technique slice). **Shipped** on the ADR 0072 brand foundation + the
ADR 0073 extrusion + the ADR 0074 studio lighting; ADR 0076 (deviation
surfacing) + ADR 0077 (camera + 5-step wizard) complete v1.

## Context

The vault design direction (`2026-06-23 Brand design extraction`, Part C
technique 3 — the Bombardier "Stripe Colour" analog) names the finish swatch as
the most visible everyday differentiator. Bombardier swapped a **pre-rendered
PNG per swatch** — a CDN fetch + spinner each time. Perimetra's geometry is
procedural (ADR 0073), so it can recolour the **same live mesh** with a
synchronous React prop update — no raster, no fetch, no latency. That gap _is_
the product's visible advantage.

Key data fact: the golden release carries **no colour/finish parameter**. A
powder-coat RAL or a galvanised finish is a cosmetic choice, not a structural
one that changes the BOM/price for v1 — so the chosen finish is **presentation**,
not engine data. (A future coating-tier that _does_ surcharge would be a real
release parameter; that is out of scope here.)

## Decision

A **`zustand` finish slice** (`scene/finish.ts`) holds the chosen `finishId`; the
scene renderer reads the resolved PBR material and overrides every piece's
`<meshStandardMaterial>`. The finish never touches the engine derivation
(I1/I4 untouched — the engine still emits the same profile-only `Scene3D`).

- **Finishes** are a curated CZ-market short list (not a paint fan deck): seven
  powder RAL colours (`antracit` RAL 7016 default, černá/bílá/šedá/zelená/hnědá/
  modrá) + `zinek` (žárový zinek — light cool metal carried by
  metalness/roughness, _not_ a near-mirror, because the ADR 0074 IBL is
  intentionally dim so a mirror metal crushes to black) + `drevo` (dřevodekor).
  Finish **names** are product-domain DATA on the option (the same pattern as the
  release's authored option-set labels), not app i18n chrome.
- **`RAL → material.color`**: the sRGB hex is auto-converted to linear and
  tone-mapped by the existing ACES pipeline (`scene-canvas`); no manual colour
  management. RAL hexes are **indicative** swatches (a screen under ACES ≠ a
  physical sample) — the picker carries the mandatory **"barva orientační —
  potvrďte dle vzorku"** caveat (Direction §7).
- **Wood (`drevo`)** uses a **procedural `CanvasTexture`** built once, lazily, in
  the browser only — no binary asset and no external fetch (**CSP-clean**),
  matching ADR 0074's procedural-over-binary precedent. Deterministic (no
  `Math.random`) so the headless capture is byte-stable; a real photo map can
  swap in behind the same `woodTexture()` accessor later.
- **§6 amber stays ABOVE the finish** (CORE*SPEC §6, the load-bearing
  invariant): a `deviated` piece renders amber `#e07b39` at \_any* finish, and the
  wood map can never attach to it — so no colour choice can hide a deviated
  element. (Deviation _highlighting_ — the toggle, emissive, edge-markers — is
  ADR 0076; this slice preserves the existing always-on amber.)
- The `<meshStandardMaterial key>` flips with **map-presence** (`mapped`/`flat`)
  so the wood↔powder boundary rebuilds the shader (a three.js `needsUpdate`
  edge), while a colour-only swap within powder mutates the live material with no
  remount. The shared cached geometry (ADR 0073) is never disposed by a swap.

The `FinishPicker` (soft-geometry circular swatches — the brand control
vocabulary) writes the slice; it is rendered in the configurator now and is
**lifted into the wizard's "Barva a povrch" step** by ADR 0077. `/scene-lab`
gained a `?finish=<id>` query (and `capture-scene.mjs` a `ROUTE` env) so each
finish was headless-captured and Read before shipping.

## Consequences

- Instant, synchronous finish swaps on the live mesh — the Bombardier
  per-swatch spinner does not exist in Perimetra.
- **Render-taste passes OWED to Martin** (not blockers): the exact `zinek`
  brightness/sheen (tuned down from a near-mirror so it reads as light metal
  under the dim IBL — a GPU render reflects more), the wood-grain prominence
  (subtle at distance), and the base-state amber-on-wood contrast (both warm —
  ADR 0076's highlight mode makes it unmistakable). SwiftShader under-represents
  specular, so the captured metal look is a floor.
- No engine/contract/schema change — all app-land R3F + a presentation store.
  Full gate green (web 119, goldens 81451.504 / 129891.504 reproduce, knip).

Related: vault `2026-06-23 Brand design extraction` (Part C technique 3 +
Direction §7); ADR 0072 (the `--color-deviation` token kept separate from
copper); ADR 0073 (the extrusion this recolours); ADR 0074 (the IBL it reflects);
`verify-3d-headless` (the capture path).
