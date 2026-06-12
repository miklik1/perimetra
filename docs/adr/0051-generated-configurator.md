# ADR 0051 — Generated configurator: UiSpec on the release, app-land 3D adapter

**Status:** Accepted (2026-06-12). Implemented in step 6 slice 1 (CORE_SPEC §10).

## Context

CORE_SPEC §8 promises tenants per-instance forms **generated** from the model
("steps, groups, and visibility come from the model, so a new product family
ships with a working wizard") and a 3D playground. Through step 5 the `ui`
field on `ProductModelRelease` was reserved-but-absent, parameters had no
display labels, and nothing in the repo could draw a `Scene3D`. Step 6 needs
the first app surface without compromising the core's purity boundaries
(engine/renderers do no I/O and never touch presentation) or I7 (vendor-only
values must be structurally unreachable from tenant surfaces).

## Decision

1. **UiSpec is release data, validated at publish.** `ProductModelRelease.ui`
   is `steps[] → groups[] → params[]` (ids + optional labels); `ParameterDef`
   gains `label` — domain wording ships WITH the model (vendor-authored
   Czech), never in app i18n catalogs, so a new family needs zero app code.
   The publish gate (`validateRelease`) enforces: every ref names a real
   parameter, every writable (non-vendor) parameter appears **exactly once**
   (an uncovered parameter would be silently uneditable — the I5 spirit
   applied to the surface), and vendor-only parameters never appear (I7 as a
   publish defect, not a UI convention). App chrome (buttons, headings,
   totals) stays in the i18n catalogs — the split is product knowledge vs.
   platform furniture.

2. **`resolveUi(release, scope)` in @repo/model** turns the spec + per-param
   `relevance` into the rendered surface — pure, so a quote's wizard is as
   reproducible as its price (I1). Visibility is **fail-open**: a relevance
   expression that cannot evaluate (e.g. references an option attribute
   before the option is chosen) leaves the parameter visible — hiding what we
   cannot judge would be the UI flavor of a silent zero. A release without
   `ui` falls back to one synthesized step over all writable parameters.

3. **The engine runs in the browser.** The configurator calls
   `deriveInstanceDetailed` + `deriveSite` per edit — purity (I1) makes the
   client a valid host; there is no calc endpoint to drift from. Quote
   persistence/stamping (I3) arrives with the quote-lifecycle slice and
   changes where results are SAVED, not where they are computed.

4. **The 3D walker is app-land** (`apps/web/app/configurator/scene/`), per
   the step-5 boundary: renderers emit pure data, presentation adapters draw
   it. The R3F walker (ported `~/gates` pattern) maps `Scene3D` instances →
   posed groups, pieces → profile-sized boxes along local X, with the
   renderers' exact conventions: piece origin at axis start, cross-section
   centered, extrinsic X→Y→Z rotation = three.js Euler order **"ZYX"**,
   arc-minutes → radians only at the three.js boundary (I10 holds in data).
   The viewport renders the SITE contract — a single config is a degenerate
   one-instance site (I11) — so the step-6 site canvas reuses it unchanged.
   No drei `<Environment>`: its CDN-loaded HDR presets violate the strict
   CSP (ADR 0026); plain lights instead.

5. **@repo/fixtures is the interim release source** (⌛ expires with release
   persistence): `app/configurator/products.ts` is the single swap point, and
   initial inputs are the golden-corpus configs — the page opens on the
   Excel-anchored derivation, asserted in the web test suite
   (`money.total === "81451.504"`).

## Consequences

- Authoring cost per family now includes labels + UiSpec, enforced by the
  publish gate — and `pnpm --filter web test` proves the wizard renders from
  release data alone (zero product knowledge in components).
- The issue panel renders `Issue.key + params` raw; the issue-key i18n
  catalog (ConstraintDef.key doubles as the message key) is deliberate
  follow-up work, as are the deviation-override UX (needs quote scope) and
  artifact overrides in the UI.
- three/R3F live only in `apps/web` behind a `ssr:false` dynamic import;
  `react/no-unknown-property` is disabled for the scene dir only (the
  documented R3F lint caveat).
- `defaultUi` keeps pre-UiSpec releases renderable, so third-party/old
  releases never hard-fail the surface.
