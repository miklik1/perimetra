# ADR 0077 — Camera choreography + the 5-step CZ wizard

**Status:** Accepted (2026-06-25 — the HQ live-3D configurator build order, the
fifth and final v1 slice). **Shipped** on ADR 0072–0076. Completes the
configurator-v1 workstream (exploded/section view 9 deferred to v2).

## Context

After ADR 0073–0076 the live gate renders with real profiles, studio light,
finish swaps, and §6 deviation surfacing — but inside the OLD single-panel
generated wizard. The vault design direction (`2026-06-23 Brand design
extraction`, Part B UX grammar + technique 6) is the Bombardier 5-step flow with
**spatial progression** (a camera move per step, not a progress bar) and a
**Summary that is the lead capture + spec sheet**. Two builds:

1. **Camera choreography** — one persistent controller animating to a named pose
   per step.
2. **The 5-step brand wizard** — Produkt · Lokalita · Konfigurace · Barva a
   povrch · Souhrn, with hybrid R3F + SVG coverage.

## Decision

**Camera (technique 6).** Drop `OrbitControls`; consolidate on drei
`<CameraControls>` in a `CameraRig` that sets `smoothTime` then
`setLookAt(…, true)` whenever the step's pose changes — an interruptible
animated transition. Poses are a **pure** `cameraPose(view, frame)`
(`camera-poses.ts`, unit-tested): `hero` (Produkt), `detail` (Konfigurace — a
lower frontal three-quarter that still fits a wide gate, never crops), `front`
(Barva — straight-on for colour), `pullback` (Souhrn reveal), plus `away` (the
§6 off-screen e2e). The hero `<SceneViewport key={releaseId}>` is persistent
across the R3F steps, so the camera animates between poses; Lokalita (SVG)
remounts it on return — an acceptable cut, since that step is a mode switch.

**The 5-step brand wizard (technique 6 + Part B).** A fixed CZ spine wraps the
release's OWN authored `ui.steps`, so **CORE_SPEC §8 holds**: the brand SHELL is
app-land, but every parameter's label/domain/options and its GROUP grouping stay
release data. `buildFlow` (`wizard-flow.ts`, unit-tested) is the data-driven
split — the release's FIRST authored step seeds **Lokalita** (dimensions / site
footprint), the REST seed **Konfigurace**; Produkt / Barva a povrch / Souhrn are
shell steps (product pick / `FinishPicker` / lead). The layout is the Bombardier
editorial split: a pinned marque + centered pill `StepNav`, a display-scale step
label (`DisplayLabel`), release params on the left, the live hero on the right.

**§8 reconciliation (documented):** the design note's "Výplň" step maps to
**"Konfigurace"** because a release authors more than an infill choice — the body
steps carry whatever the release grouped, never a hardcoded parameter list. The
brand step labels (Produkt/Lokalita/…) are app-shell; the release's group labels
(Otvor, Rám, Výplň…) render as the fieldset legends underneath. (The old
release-step `Wizard` stays — it is `/site`'s per-instance editor; the
configurator now uses the new `ParamGroups`.)

**Hybrid coverage (technique 10).** Live R3F on Produkt/Konfigurace/Barva/Souhrn;
the pure `drawing2d.ts` SVG for the **Lokalita plan** (`SitePlanSvg`), the
**Summary side-elevation** (`WorkshopDrawingSvg`, which also renders the §6
`DrawingFlag`s — the 2D deviation mirror), and the **WebGL-unavailable fallback**
(`webglAvailable()` → the elevation instead of a dead canvas). `deriveForUi` now
also emits the `drawing` + `plan` (pure, off the same valid result).

**Souhrn / Poptávka.** The configuration IS the spec sheet (release-resolved
params + the chosen finish) + the price/BOM (`ResultsPanel`) + deviations
(`DeviationPanel`) + a **reproducible config-hash share link** (`config-hash.ts`,
unit-tested — the I3 tie: the same encoded inputs re-derive the same result;
restored on load via `?c=`) + a lead-capture form. The lead SUBMIT is a
presentation confirmation for v1 — the configurator preview is not yet a
persisted project, so wiring it to the projects/quotes `issue` path is a
follow-on; the share link already makes the config durable.

## Consequences

- The configurator is now the branded, spatial, 5-step Bombardier-grammar flow —
  v1 is complete (4+2+3+8+6 shipped; only exploded/section 9 deferred).
- **Render-taste passes OWED to Martin** (not blockers): the camera-move pacing
  (`smoothTime`) and the editorial layout proportions are calibrated against a
  GPU render + the authed full-stack page (the wizard DOM needs the live api +
  catalog + a session — `WEB_PORT=3002 pnpm dev`, operator `admin@perimetra.local`);
  the 3D poses themselves were headless-verified (hero/detail/front/pullback all
  distinct + full-fit).
- Pure helpers (camera-poses, wizard-flow, config-hash) are gate-covered; the §6
  e2e still passes through the `CameraControls` path.
- No engine/contract/schema change — all app-land. Full gate green (web 140
  incl. new pure tests, build, knip, 2 e2e; goldens 81451.504 / 129891.504
  reproduce, i18n parity).

Related: vault `2026-06-23 Brand design extraction` (Part B + technique 6/10 +
Direction §3/§6); ADR 0072 (the kit primitives — StepNav/DisplayLabel/Panel);
ADR 0074 (the studio the camera frames); ADR 0075/0076 (finish + deviation the
steps host); `drawing2d.ts` (the SVG source); `verify-3d-headless`.
