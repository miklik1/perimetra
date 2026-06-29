# ADR 0096 — Configurator materials + environment relight (dark finishes read as metal)

**Status:** Accepted (2026-06-29 — core-hardening slice 2, after slice 1's
geometry fix, ADR 0095). **Implementation:** Implemented, pure app-land —
`apps/web/app/configurator/scene/scene-canvas.tsx` (lighting rig + tone-mapping
exposure + contact-shadow), `apps/web/app/configurator/scene/scenes.ts` (studio
ground tone). **NO `model`/`engine`/`renderers`/`fixtures` change — I1–I11
untouched, goldens reproduce (`81451.5`, `81849.192`, delta-0, the slice-1
geometry-position golden).** Verified eyes-on (the standing rule): Playwright +
SwiftShader capture of the real `sliding-gate@1` fixture through `/scene-lab`,
read the PNGs, before/after across antracit / bílá / žárový zinek / dřevodekor.

## Context

On the same live review that drove slice 1 (Martin), the configurator's gate read
as "material none / environment bad" — the default **antracit (RAL 7016)** powder
finish rendered as a flat **black silhouette** with no form, sheen, or panel
definition. Lighter finishes (bílá, zinek) rendered fine.

A three-way ground-truth (the core-hardening review `wf_f4a764a5-84e`) and a fresh
code map showed the cause is **lighting, not the material**: the perimetra antracit
hex (`#383E42`) is **identical** to the working gates-MVP's, but the studio IBL was
deliberately tuned dim (`finish.ts:107` admits it: "a near-mirror metalness reflects
black and crushes toward anthracite"). The proven gates-MVP lit the same hex with
`exposure 1.5`, `ambient 1.0`, a hemisphere fill, two directionals, and a real
`<Environment preset="city" environmentIntensity={0.8}>`. A dark albedo (~4 %
reflectance) under a dim rig has no diffuse floor → near-black.

The CSP `connect-src 'self'` blocks drei's `city` preset CDN fetch (polyhaven); a
self-hosted `.hdr` would be CSP-clean but adds a sourced binary asset, and its main
benefit (specular environment reflections on the metallic finishes) is exactly what
the SwiftShader headless capture under-represents — so it can't be eyes-on verified
here anyway. ADR 0074's procedural-over-binary stance still holds.

## Decision

**Relight the studio to model dark finishes, keeping the procedural CSP-clean IBL
(no binary HDRI).** The dark-lift comes from the **fill** (ambient + hemisphere),
not global exposure — so a light finish (bílá) doesn't blow out:

- `toneMappingExposure` `1.0 → 1.18` (ACES rolls off highlights).
- `ambientLight` `0.3 → 0.55`; **new** `hemisphereLight(["#eef3f8", "#5a6470", 0.5])`
  sky/ground fill (the gates-MVP move) — lifts a dark albedo's diffuse floor.
- The warm key directional `1.6 → 1.7` (panel/ground tonal separation so white
  doesn't melt into a light ground); **new** cool fill directional from the opposite
  side (`0.7`) so the shadowed face isn't crushed.
- Procedural Lightformer IBL intensities lifted ~1.3× (key 3.2→3.6, fills 1.1→1.5,
  back 2.4→2.6, ground 0.5→0.8) — the environment now models a dark metal's form.
- Studio ground `#c7c4be → #b8b3ab` (a mid-light concrete) + `ContactShadows`
  opacity `0.5 → 0.6` — separates every finish, dark and light, from the floor and
  grounds it firmly. `scenes.test.ts` only asserts `ground !== null`, so the tune is
  free.

Verified across the finish range: antracit/černá read as modelled anthracite metal
(was black), zinek/bílá keep their light read with panel separation, dřevodekor
warm. Lighting is render-taste with no golden — the eyes-on capture IS the
verification (per the standing rule); the gate covers type/lint/build/knip + every
unit test + the unchanged goldens.

## Scope — what slice 2 is NOT (flagged, gated, NOT silently bundled)

The hardening plan tentatively grouped two more items into "materials + environment".
The code map changed their cost; both are deferred with their findings:

- **Box-fallback profiles** (`tower_post`, `top_guide_beam` render as bare 40×40
  boxes). The fix is authored DATA (a catalog `section`), but `geometry.profile`
  feeds the **frozen** `cutList` + 2D `drawings` (`cutlist.ts`, `drawing2d.ts`) —
  both re-derived by `verifyReproducibility` — so giving `tower_post` a real
  `jakl_100×100` **rebaselines those goldens** (price golden unchanged), i.e. it
  needs a new catalog version + Martin's golden sign-off. The V-rail (`top_guide_beam`)
  section is genuinely **FIL-blocked** (the proven gates-MVP render omits it). Its
  own gated slice. A renderer-side smarter default was rejected — it deepens the I4
  violation the current 40×40 already is.
- **Catalog-driven finishes** (`Material.finishes?: string[]` is a confirmed dead
  stub). Wiring it is app-land (zero golden/model impact — `finishes` is consumed
  nowhere but a future picker filter), but filtering a **global** finish by a
  possibly **mixed-material** gate is a real design call for marginal value (hide
  žárový-zinek on aluminium). Its own small slice, not bundled here.

## Consequences

- First slice to touch the studio LIGHTING (the v2 slices and slice 1 left it alone).
  Pure presentation: no engine/renderer/catalog/release change; I1–I11 untouched;
  every golden reproduces.
- The single tuned `toneMappingExposure` stays a literal — a per-scene/per-HDRI
  `ScenePreset.exposure` seam (reader-flagged) is deferred as YAGNI: every scene
  shares the one procedural IBL today, so the value would be identical 4×. A real
  HDRI swap (self-hosted, CSP-clean) is the natural slice to add it.
- Panels still read as solid slabs (the PLAŇKA fill spacing/types are slices 3–4)
  and frame members are thin (the deferred box-sections) — both correctly out of
  scope; the antracit-black complaint is resolved.
- Local `next build` needs `SKIP_ENV_VALIDATION=1` on this box (`apps/web/.env.local`
  sets `API_URL=http://localhost:4002`; prod-mode build requires https) — a
  pre-existing env guard, orthogonal to this change.
