# ADR 0093 — Configurator in-context preset scenes (v2, the §8 backdrops)

**Status:** Accepted (2026-06-28 — configurator v2, slice 3 of 3; the §8
"visible in-context backdrops" deferred by ADR 0074). **Implementation:**
Implemented (app-land only — `apps/web/app/configurator/scene/`; no
`model`/`engine`/`renderers`/`fixtures` change, I1–I11 untouched, goldens
reproduce). Completes configurator v2.

## Context

The explode (ADR 0091) and section (ADR 0092) slices reveal the assembly; this
slice sets the STAGE — a chosen scene swaps the viewport backdrop so the
configured gate reads as installed (on a driveway, a fence line, a garden)
instead of floating in a studio. ADR 0074 reserved "a real HDRI" for this, but a
self-hosted `.hdr` adds a binary asset + a CSP origin; per the v2 plan's design
fork this slice is **procedural geometry, keeping the studio IBL** — the same
CSP-clean precedent as the Lightformer fill.

Like every configurator viewport mode it is pure presentation: the scene choice
never touches the engine, BOM, or price (I1/I4) — the finish-slice precedent.

## Decision

- **A `useScene` slice + curated `SCENES` data** (`scenes.ts`, mirroring
  `finish.ts`): each preset carries a sky tint, an optional ground material
  (`null` = the studio neutral field, the default), and a `context` enum. Scene
  LABELS are product-domain data (cf. finish labels), not i18n chrome.
- **A procedural `SceneBackdrop`** (`scene-backdrop.tsx`) sized off the scene
  `frame`: a large ground plane a hair below `groundY` (so the soft
  `<ContactShadows>` reads as the gate's shadow ON the floor, no z-fight) + light
  context geometry per scene — masonry **pillars** (driveway), receding **fence**
  posts (fence line), a low **hedge** (garden). All boxes/planes, no HDRI/binary.
  `studio` renders nothing (the v1 field). The per-scene sky drives the Canvas
  `<color attach="background">`.
- **The clip + memo discipline holds.** The section `clippingPlanes` are
  per-material on the PIECES only, so the backdrop is never clipped; and the
  `memo`'d walker's props don't change on a scene switch, so swapping scenes never
  reconciles the piece tree (the canvas re-renders only the cheap backdrop +
  picker).

## Consequences

- Zero schema / engine / renderer-package change — `scenes.ts` (data + slice) +
  `scene-backdrop.tsx` + the canvas wiring (sky/backdrop/picker). Goldens
  reproduce; I1–I11 unaffected. **Configurator v2 is complete** (explode +
  section + preset scenes).
- The backdrop is presentation-only: the chosen scene is NOT a release parameter
  and never gates a catalog or anchoring (the finish-slice precedent). A
  vendor-authored default scene per model would be a schema addition + publish
  gate — deferred.
- All visuals (ground colours, sky tints, context dimensions, whether a real HDRI
  eventually replaces the procedural fill) are render-taste, owed to Martin's eye
  — structure here, not pinned values. Headless SwiftShader under-represents the
  look, so the calibration is the standing render-taste CHECK.

Related: ADR 0074 (the studio IBL this keeps + the deferred-backdrop note it
closes), ADR 0091 / 0092 (the explode/section slices + the `memo` render
discipline), ADR 0075 (the finish slice — the presentation-state + domain-label
precedent), ADR 0050 / I4 (renderers stay pure — the backdrop is app-land).
