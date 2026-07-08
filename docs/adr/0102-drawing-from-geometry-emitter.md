# ADR 0102 — The 2D technical drawing is a derived emitter off the one geometry SoT

**Status:** **Proposed** (2026-07-08 — documents the as-built Phase-2 drawing
spike on the `branka@1` family; the `ADR pending` / `ADR 0102` citations in
`packages/renderers/src/drawing/**`, `packages/model/src/drawing.ts`, and the
`apps/web/app/configurator/scene` convergence refer here). The **architecture**
is decided (Martin's four spike decisions below); the flip to **Accepted** is
gated on Martin's own eyes-on sign-off of the captured render, the same taste gate
as ADR 0098.

## Context

CORE*SPEC §5 makes the cut list, the 3D scene, and the 2D technical drawing three
\_renderers* — pure functions of `(Site, SiteResult)` that expand the engine's
already-baked pieces (profile + pose, I4) and emit **pure data** (I1); presentation
(R3F / SVG / PDF) is app-land. The cut list and 3D scene shipped that way; the 2D
drawing did not exist. The naive path — author a separate 2D model per family — is
the drift trap the whole "product knowledge is data" thesis exists to avoid: a hand-
drawn 2D that disagrees with the 3D and the BOM, re-authored for every one of the M4
families (CAR-32/33/34). This spike settles whether the 2D drawing can instead be a
**fourth emitter off the same geometry source of truth**, so it is Excel-number-true
by construction, gives multi-view for free, and every new family gets its 2D by
authoring geometry + a small drawing spec — nothing to redraw.

The prototype family is **branka** (a pedestrian gate — the simplest structural
leaf, no sliding-gate tail/HLR risk); its geometry was authored byte-true to
`2026-PC_Branky_FINAL_PC.xlsx` (1×SP) as the substrate the drawing derives from.

## Decision (as-built)

**1. The drawing is a pipeline of pure stages off `DerivationResult`, keyed to
the one geometry SoT** (`packages/renderers/src/drawing/`):

```
DerivationResult
  → SolidModeler       expand each baked PartPiece → role-tagged PieceSolid (edges + section outline)
  → ViewProjector⊕HLR  orthographic project + silhouette-floor hidden-line removal → ViewLinework
  → Sectioner          axis-aligned plane cut → hatched cross-sections (SectionView)
  → Annotator          DrawingSpec rules → AnnotationIntent (feature-bound, value from the derived scope)
  → DimensionSolver    lane-stacked, collision-free placement (zero hand-layout)
  → Orchestrator       → TechnicalDrawing
```

Each stage is pure (I1), I4-clean (expands baked pieces, never opens the catalog or
recomputes from config), and I5-honest (an invalid derivation has no drawing).
Ordering is id-keyed (I9) and coordinates snap to integer mm, so the output is
**byte-deterministic** — the property the self-golden depends on.

**2. The drawing rules are IMMUTABLE release data** — a `DrawingSpec` sibling of
`ui?` on `ProductModelRelease` (`packages/model/src/drawing.ts`). A rule binds a
dimension/chain/label to a **named model feature** (an I9 piece-id glob) and prints
its value from a **derived-scope key** — so the number the drawing prints _is_ the
number the engine derived (and the BOM / golden use). The spec freezes into the quote
snapshot, so a re-derived historical quote reproduces byte-identical drawings (I3).
The DSL is kept minimal (three rule kinds, one glob grammar, an axis-aligned section
plane) — a drawing DSL's failure mode is ballooning into a mini-CAD language, which
defeats the amortisation.

**3. Publish-time validation is a zero-drift sibling of `slotScopes`.**
`drawScopes(release)` (`packages/model/src/validate.ts`) computes the reference
universe a `DrawingSpec` may target — the derived keys a rule may print, and the
piece-id specimens a feature glob may match — and `validateRelease` consumes it
(`drawing.derived.unknown`, `drawing.feature.nomatch`, duplicate view/section/rule
ids). Crucially the gate matches globs with the **same `pieceGlobToRegex`** the
runtime Annotator uses (the grammar now lives once, in the model that owns the DSL,
imported by the renderer) — a rule that passes validation is a rule that resolves at
runtime, and the editor's future autocomplete lights up from the same source.

**4. ProfileLibrary is the single cross-section authority — 3D converges onto it
NOW** (Martin's decision, overriding the defer option). Both the 2D emitter and the
app-land R3F walker resolve the real catalog **envelope** (`w × d`) through
`profileEnvelope` (`@repo/renderers`): `apps/web/app/configurator/scene/
profile-geometry.ts` and `frame.ts` were rerouted to it (byte-identical to the prior
inline fallback — the position golden ADR 0095 and all 46 scene tests hold, 3D eyes-on
re-confirmed). The honest-vs-presentation seam stays explicit and app-land: the shared
authority reports the real dims and `nominalDepth`; only the walker substitutes a
presentation depth for a depth-less profile, and the 2D section degrades to a flagged
outer outline. Interior detail (L/U/T legs in 3D, hatching in 2D) stays each
consumer's presentation elaboration _within_ that one agreed envelope.

### The four spike decisions (Martin, 2026-07-08) — locked

- **(f) "Excel 1:1" = a dim-value oracle + a structural self-golden, NOT an image
  diff.** The Obrázky are undimensioned A–I schematics and no dimensioned FIL drawing
  exists, so fidelity is proven by each printed dimension equalling the derived key
  (`branka.drawing.test.ts`) plus a canonical-JSON lock of the whole
  `TechnicalDrawing` (`branka.selfgolden.test.ts` + `golden/branka-drawing.golden.json`).
- **Converge 3D NOW** (decision 4 above).
- **Section = real depth/wall, but the catalog lacks it → honest outer-outline
  fallback.** The `h50`/flat sections carry no `wall_mm`/`d_mm`; the Sectioner draws
  the outer envelope and flags `nominalDepth`/`dataFillNeeded` (data-fill needed),
  never an invented wall. When FIL's wall/depth data lands, the outline upgrades with
  no interface change.
- **The geometry spine is renderers-local** — extract to a `packages/geometry` only
  when a non-renderer / CAM consumer appears.

## Consequences

- **M4 breadth (CAR-32/33/34) inherits this.** Each family authors geometry + a
  `DrawingSpec` and gets its 2D drawing free, Excel-true, drift-proof against the 3D
  and BOM. This ADR is the gate that was blocking family re-authoring.
- **Verified on branka@1:** front elevation + feature-bound dims Excel-true (780 /
  910 / 1400 / 1470 / 127-pitch chain, member letters A–D), one hatched section A–A
  exercising both the real-depth (rails) and the honest-degrade (flat slats) paths,
  the whole drawing structurally golden-locked, and eyes-on captured (2D via
  `capture-drawing.mjs`, 3D convergence via `capture-scene.mjs`).
- **Invariants I1–I11 untouched.** New model export surface (`DrawingSpec`,
  `SectionDef`, `pieceGlobToRegex`, `drawScopes`) and renderer surface (`buildSection`,
  `SectionView`, the drawing pipeline) are additive; publish stays the immutable path,
  so I3 is untouched. The `validateRelease` drawing branch is additive and fires only
  when a release authors `drawing` (no api-seeded release does today, so no shipped
  behavior changed).
- **Deferred, deliberately** (not architecture): cosmetic layout backlog (B/D label
  collision, undrawn mitre corners, chain spine line); the structured editor workbench
  for drawing rules (raw-JSON island for now); oblique section planes AND oblique-to-
  section members (the section cut is exact only when a member's axis is parallel to
  the plane normal — true for every axis-aligned gate member; a diagonal brace's cut
  face would be foreshortened, documented in `section.ts`); a value-Expr rule form (the
  DSL prints a derived key, not yet a full Expr). The `drawScopes` gate accepts any
  concrete/wildcard repeat index (canonicalised to the `[0]` representative — it cannot
  and does not check the evaluated count, matching `slotScopes`' static posture and the
  runtime's no-op-on-out-of-range).
- **branka scope here is 1×SP geometry-complete ONLY.** The 8-variant matrix, hardware
  BOM, and priced total are the CAR-34 breadth follow-on, not this spike.
- **Status stays Proposed** until Martin's eyes-on sign-off of the render, then flips
  to Accepted (the ADR 0098 precedent).

## Alternatives rejected

- **Author a separate 2D model per family** — the drift trap; re-drawn per family,
  can silently disagree with the 3D/BOM. Rejected: it defeats "product knowledge is
  data."
- **Rasterise the WebGL 3D render to 2D** — not pure data, not dimensionable, not
  reproducible (I3), GPU-bound. Rejected.
- **Defer the 3D→ProfileLibrary convergence** (the recommended-safe option) — Martin
  chose to converge now so there is one cross-section authority before M4 multiplies
  the families; the byte-identity guard made it low-risk.
