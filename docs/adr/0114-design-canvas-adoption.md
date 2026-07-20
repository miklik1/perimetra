# ADR 0114 — The `design/` canvas export is the design authority for the product UI wave

**Status:** Accepted (2026-07-20 — Martin exported the claude.ai/design canvas into
the repo at `design/` and directed that the product UI be built to it).
**Implementation:** Not started — this ADR fixes the authority model, the
reconciliation finding, the token-pipeline enforcement decision, and the ownership
boundaries so the surface-by-surface build can proceed without re-litigating them.
Successor to ADR 0111 in the design lineage: ADR 0111 built the system, this ADR
says what now governs its application. Extends ADR 0072 (the brand foundation) and
ADR 0078 (the typeface trio); supersedes nothing. Its companion artifact is
`design/README.md`, written in the same wave as this ADR, which carries the running
record of gap decisions made against a silent canvas (§5).

## Context

The repo has, since ADR 0111, carried a complete design system: one OKLCH token
source authored at `tooling/tailwind-config/theme.css`, and a 35-component kit at
`packages/ui` built on the Vercel composition patterns. What it has never carried
is a **design** — an information architecture, a navigation model, a set of
layouts, a decision about what a screen is for and how a user moves through it.
The implemented surfaces (`/configurator`, `/quotes`, `/orders`, `/projects`,
`/customers`, `/admin`, `/platform`) were each built to satisfy an engine or a
backend slice, one at a time, over a long build. They are architecturally
disciplined — the data layer sits outside `app/` in `lib/*-queries.ts`, the RSC
prefetch → hydrate → client-leaf shape is uniform, and the pure compute modules
under `app/configurator/` are tested and factored — but none of them was ever
designed. `app/page.tsx` is still, today, the unmodified skeleton demo rendering
a users list against jsonplaceholder.

The claude.ai/design canvas at `design/` closes that gap. It is nine HTML boards
plus a shared React chrome layer (`design/configurator/parts.jsx` and eight
`frames-*.jsx` files) covering the whole product: the internal configurator
(desktop form-based, immersive fullscreen, invalid-config, tablet, mobile), the
public lead-catcher flow (desktop and phone), the leads inbox, the customer
nabídka (printable A4 and its online twin including the accepted state), the
catalog admin, the orders/order→cash surface, and the owner's dashboard. Each
board carries multiple viewport frames, real Czech copy, and — critically — the
states that matter: selected, invalid, blocked-price, locked-step, done/active/
future, price-blind. It is the first artifact in this project that answers "what
does this product look like when a person uses it". The brief that produced it,
`design/uploads/Design handout — Perimetra (for Claude Design).md`, ships inside
`design/` and is part of the authority: it is the stated intent behind every board.

The question this ADR exists to settle is what the canvas's arrival means for the
design-system plumbing already in the repo, and for the UI already shipped.

## Decision

### 1. The reconciliation finding: the canvas speaks our own vocabulary

The canvas export bundles its own copy of the design system at
`design/_ds/perimetra-design-system-0f4e8eb1-8530-4316-9866-ab32e08b499f/`. **The
token and component payload of that copy is byte-identical to the repo's own
`ds-bundle/`** — specifically `styles.css`, `_ds_bundle.css` (md5 `55bfdde1…`) and
`_ds_bundle.js` (md5 `d5d1d3a7…`) all match, and both sides carry the same
claude.ai/design project UUID.

The two _directories_ are not identical, and the ADR should not be read as saying
they are. The export is a compiled subset: it carries `_ds_manifest.json` and
`_adherence.oxlintrc.json` that `ds-bundle/` lacks, while `ds-bundle/` carries the
sync ledger, the build metadata, 35 component directories, `_preview/`,
`_screenshots/` and `_vendor/` that the export lacks. **`README.md` differs between
the two**, which matters because §2 below finds `ds-bundle/README.md`'s dark-mode
claim to be false of the shipped artifact. The governing README for this repo is
`ds-bundle/README.md` — it is the one generated alongside our build metadata — and
the correction recorded in §2 applies to it; the export's README is the canvas's
own copy and is not edited.

The substantive evidence of provenance is not the file-count overlap but
`ds-bundle/.bundle-entry.mjs`, which re-exports absolute local paths into
`packages/ui/src/`. A bundle whose entry point points at this repo's source tree
was built _from_ this repo. `.ds-build-meta.json` corroborates it, recording
`{"source":"@repo/ui@0.0.0","shape":"package","componentCount":35}`. (Note that
`styles.css` matching is worth nothing on its own as evidence: it is a 57-byte file
containing two `@import` lines and no tokens at all, so any two bundles this tool
produces will match on it. It is listed above for completeness of the payload
comparison, not as proof.) The bundle is an **outbound** build artifact of this
repo that was pushed to the canvas; the copy under `design/_ds/` is the canvas's
stored copy of what we sent it.

The canvas was therefore authored **against our own shipped tokens and kit**, not
against a parallel design-tool vocabulary. Adoption requires **no token migration,
no value reconciliation, and no mapping layer**. `tooling/tailwind-config/theme.css`
is the authored source of the token vocabulary and `packages/ui` is the authored
source of the components; the canvas is a consumer of both, not a competing
definition of either.

The token probe confirms this at the vocabulary level rather than taking it on
trust. Every distinct `var(--token)` reference across `design/configurator/*.jsx`
and `design/*.html` — 36 of them — resolves against `theme.css`, and every one of
the theme-backed utility classes the frames use (`bg-chrome`, `font-data`,
`rounded-card`, `ease-brand`, `text-copper`, `bg-spotlight-subtle`, …) is defined
there. **The probe found no utility and no token used in the canvas that
`theme.css` does not define.** The only unresolved `var()` names are nine
`--doc-*` layout locals that `design/configurator/doc-page.js` defines itself, and
the hardcoded hexes in the frames are legitimate domain data — RAL swatch colours
and a phone-bezel mock — not token evasion.

**The token pipeline has two copies of `theme.css`, and the second one is
unenforced.** This must be stated plainly, because an earlier draft of this ADR got
it backwards. The design-sync pipeline does **not** read
`tooling/tailwind-config/theme.css` as its token input. `.design-sync/config.json`
sets `"tokensGlob": ".ds-css/theme.css"`, which resolves to
`packages/ui/.ds-css/theme.css` — a **manually maintained copy**.
`.design-sync/NOTES.md` instructs that the copy be kept in sync by hand. (Its
"goes stale silently" warning is about a _different_ file —
`packages/ui/.ds-css/compiled-tailwind.css` — and is not cited here as evidence
about `theme.css`; the hand-sync instruction is.) The two files are byte-identical
today (md5 `159f4c2c529b0370304b5dcfae7d281a` on both), but **nothing enforces
it**: there is no test, no lint rule, no script and no CI step anywhere in the repo
that compares them. That no-enforcement finding stands on its own inspection of the
repo, independent of anything NOTES.md warns about.

The consequence is the inverse of a drift detector. Edit `theme.css`, forget the
manual copy, and the sync ledger's `styleSha` is computed from the _stale_ copy,
reports no style change, and the drift becomes **invisible** — worse than
undetected, because the pipeline actively reports "no change". This ADR therefore
does **not** claim that the ADR 0111 staleness hazard is closed by a named
detector. There is no such detector today. What this ADR does instead is decide the
fix, and schedule it in the prerequisite slice (§7).

The fix is constrained by a fact that rules out the obvious remedies:
`packages/ui/.ds-css/` is **not tracked by git** (it is excluded via
`.git/info/exclude`, deliberately, because a sibling agent session works this repo
live). A test asserting md5 equality is therefore unworkable — in CI or a fresh
clone the file does not exist, so the test either fails universally or skips
silently and enforces nothing. A committed symlink is unworkable for the same
reason. **The correct fix is to generate the copy rather than check it**: make
`packages/ui/.ds-css/theme.css` a build artifact of a single scripted design-sync
preflight that copies the canonical `theme.css` and runs the Tailwind compile in
one command, so `tokensGlob` and `cssEntry` are always derived from source in the
same action. Because the directory is generated and untracked, regenerating it is
free and always correct, and there is nothing authored there to keep in sync. That
generated-preflight decision is the durable half of the fix, and it stands.

The same tracked-versus-untracked reasoning must be applied honestly to the _other_
file in this pipeline, because an earlier draft applied it to one and not the other.
`.design-sync/` is excluded exactly as `packages/ui/.ds-css/` is — `git check-ignore`
resolves `.design-sync/tailwind-entry.css` to `.git/info/exclude:18`, the file is
untracked, and it is absent from a fresh clone. So an assertion that
`.design-sync/tailwind-entry.css` imports the canonical
`tooling/tailwind-config/theme.css` is **not** checkable in a fresh clone or in CI,
for precisely the reason the md5-equality test was rejected two paragraphs above.
The import does exist today (`tailwind-entry.css` line 2 is
`@import "../tooling/tailwind-config/theme.css";`), but its existence is a fact about
a developer machine that has run design-sync, not a fact about the repository.

This ADR therefore decides the guard in the only two forms that are actually
executable, and an implementer picks one rather than assuming the fresh-clone form
exists. Either the guard runs **as part of the preflight itself**, on a machine where
`.design-sync/` is present, failing that one command when the import is missing — a
real check at the moment it matters, but one that CI and a fresh clone never
exercise. Or `.design-sync/`'s durable subset is **committed first**, which
`.design-sync/NOTES.md` already contemplates, at which point the entry file is tracked
and a fresh-clone-checkable assertion becomes possible. Committing that subset is an
explicit **precondition** of the fresh-clone form of the guard, not something it may
assume. Whichever form is chosen, the load-bearing protection remains the generated
preflight: the copy cannot go stale because nothing authors it.

Two further notes on the sync ledger, so that no future reader over-reads it.
First, `_ds_sync.json`'s `sourceHashes` map has 105 entries and **none of them is
CSS** — every key is a component `.jsx`, `.d.ts` or `.prompt.md` path. That map
covers components only and contributes nothing to style-drift detection; the style
layer is represented by the single `styleSha` scalar. Second, the recipe by which
`styleSha` is computed is **not documented in this ADR because it could not be
reproduced** from `theme.css`, `_ds_bundle.css`, `styles.css` or any tested
concatenation of them, and no design-sync library source in the repo defines it.
It is an opaque content hash over the style layer. Do not build enforcement on an
assumed recipe.

Finally, `ds-bundle/` currently carries a `_ds_needs_recompile` marker
(`{"by":"design-sync-cli"}`) alongside a `.sync-diff.json` recording
`styleChanged: true`, 16 changed and 19 added components, and `upload.any: true`.
This is a **pending-upload** state, not a stale-bundle state: the mitigating fact
is that **no file under `packages/ui/src` or `tooling/tailwind-config/theme.css` is
newer than `ds-bundle/_ds_bundle.js`**, so the bundle is current against its
source. What is outstanding is the push of that bundle to the canvas, not a rebuild
of it. Any token or kit change made during this wave must still be followed by a
design-sync run, or the canvas will keep rendering a system the repo no longer
ships.

### 2. The divergence the probe actually found: two gaps, both additive, plus two defects

The design handout predicted that design would "work WITH these tokens/components —
gaps get filled (spacing/state colors), not replaced". Both predicted gaps are real
and both are still open. They are the additive work this ADR authorizes; neither is
a conflict with the canvas.

**No spacing scale.** `theme.css` defines no `--spacing-*` / `--space-*` /
`--size-*` token whatsoever (the only `spacing` matches in the file are
`--text-*--letter-spacing` sub-properties), and the type scale tokenises only three
editorial roles (`--text-display`, `--text-title`, `--text-metric`). With nothing
to reach for, the canvas frames improvised: 256 `gap:` values, 290 `fontSize:`
values, and 171 `padding:` values across `design/configurator/*.jsx`. The
font sizes span a 23-step ramp with half-pixel rungs (10, 10.5, 11, 11.5, 12, 12.5,
13, 13.5, …). An implementer reading a frame cannot tell which of those numbers is
a considered decision and which is an accident of authoring. A spacing scale and a
body-type ramp must be added to `theme.css`, and the canvas's improvised values
snapped onto them during implementation. Where a canvas value has no scale
equivalent, the scale wins — matching the canvas to the half-pixel is not the bar.

**No interaction-state colours.** Only `--color-copper-hover` exists (light and
dark). There is no hover/active/pressed/disabled token for `primary`, `secondary`,
`chrome`, `nav-active`, `destructive`, `success`, `warning` or `info`;
`--color-nav-active` is a semantic surface token, not an interaction state. The
canvas improvised with five ad-hoc `color-mix()` calls, and one frame carries a
defensive fallback (`var(--color-warning-subtle, color-mix(…))`) for a token that
**does** exist — evidence that the vocabulary is real but not discoverable from the
canvas side. A state-colour layer must be added to `theme.css` alongside the
spacing scale.

The probe also surfaced two defects in the shared source that the canvas exposed
but did not cause, and that must be fixed before dark mode can be trusted on any
new surface. Both have the same root cause: `theme.css:156` opens a **top-level
`@variant dark { … }`** — an `@variant` with no enclosing selector for its `&` to
bind to.

- **In the app build**, `apps/web/app/globals.css` registers
  `@custom-variant dark (&:where(.dark, .dark *))`, so the variant resolves, but at
  top level the `&` becomes `:scope` and the block compiles to
  `:scope:where(.dark, .dark *)` — which in a document matches **`html.dark` only**.
  The 47 token overrides inside it therefore do not apply to a scoped `.dark`
  subtree, while the `dark:` _utilities_ compile without `:scope` and do match at
  any depth. `apps/web/app/brand-lab/brand-lab-client.tsx` applies `.dark` to a
  `<div>`, so `/brand-lab?theme=dark` renders **half-flipped** — the very route
  ADR 0111 designated as the eyes-on verification surface.
- **In the exported bundle**, `.design-sync/tailwind-entry.css` imports the
  canonical `theme.css` directly but **never registers `@custom-variant dark`**, so
  Tailwind's stock `dark` variant (`@media (prefers-color-scheme: dark)`) applies to
  a top-level `@variant` body and emits 47 custom-property declarations sitting
  directly inside the media query **with no selector block**. Browsers discard
  declarations in that position, so **the exported bundle's entire dark layer is
  dead**, and `ds-bundle/README.md`'s claim that a `.dark` ancestor flips the tokens
  is false of the shipped artifact.

The fix is one line at `theme.css:156` — `@variant dark {` becomes `.dark {` —
verified by recompilation to emit all 47 declarations intact at the identical
position in the output, unlayered, exactly where `:scope:where(…)` sat. It is
**strictly value-preserving**: custom properties inherit, so a bare `.dark`
selector covers descendants without needing the `.dark *` half that utilities
require; `html.dark` still matches `.dark`, so the existing root-level path is
unchanged and only the scoped-subtree path is newly fixed; and the rule stays
unlayered, which beats `@layer theme` regardless of specificity exactly as today.
The durable companion change is to move the `@custom-variant dark` declaration
**into `theme.css` itself**, so every consumer inherits it and no future compile
entry can forget to register it — this is what prevents the bundle-side variant of
the defect from recurring, and it is the same class of hazard as the unenforced
`.ds-css` copy in §1.

Both fixes are token-layer, both are in scope for the first implementation slice
(§7), and neither changes any token's value.

### 3. What design owns, and what it does not

Per the handout, the canvas is authoritative over **information architecture,
navigation, layout, flow, presentation and interaction**. Where the canvas has an
opinion about how a screen is organised, what sits next to what, what the user
does first, or how a control behaves, that opinion governs.

The canvas is **not** authoritative over, and its frames must not be read as
license to change:

- **Domain truths.** Which states exist and what they mean, the lifecycle
  transitions, what data the system actually holds. The canvas draws an orders
  list with a customer name and a value column; the API's `orderSchema` carries
  neither (ADR 0109) and the fix is a backend decision, not a design one. The
  canvas draws a six-stage order timeline; the real machine is
  `confirmed | in_production | completed | cancelled`. Where the canvas and the
  domain disagree, the domain wins and the design is adapted to it.
- **Price-blindness on workshop surfaces.** ADR 0056 makes the workshop role
  price-blind **by absence** — the price-table endpoint 403s, `fetchCatalogBundle`
  yields `prices: null`, and the workshop DTO strips money server-side before it
  reaches the wire. The canvas is a money-dense set of internal boards drawn for
  the owner; it draws no price-blind variant of any of them. **No redesign may
  introduce a price column into a workshop-reachable surface.**

  **The enforcing layer is the server, and it is genuinely covered — at both the
  unit and the HTTP level.** An earlier draft of this ADR claimed the ADR 0056
  price-blind DTO had zero spec coverage; that claim was an artifact of a broken
  measurement and is false. Server-side unit coverage:
  `apps/api/src/modules/quotes/production.test.ts:61` is a direct test of the
  price-blind DTO (`describe("toProduction — the workshop-safe shape (CAR-24)")`),
  and `apps/api/src/modules/quotes/quotes.service.spec-rows.test.ts:2,83` covers
  the frozen spec sheet a workshop prints (ADR 0108), line 83 pinning that
  `price.manufacturing_rate` — a CZK/hr figure — must not reach the workshop.
  Server-side HTTP coverage: `apps/api/test/roles.itest.ts:143` ("workshop:
  price-blind reads, no issue, no publish, no price tables") asserts the strip
  happens **server-side** — total null, snapshot money and cost both gone, the
  blind whitelist dropping cost per ADR 0059; `apps/api/test/quotes-production.itest.ts:167`
  asserts admin, sales and workshop receive an identical, role-independent shape;
  and `:182` asserts the widened list stays price-blind, with the list total null
  for workshop.

  A note for anyone re-measuring this: grepping for the string `workshop` does
  **not** measure the client-side net. Of the client test files named below, only
  `production-view.test.tsx:86` contains that word at all, and then only in a
  `describe` title; the rest match on price absence (`prices: null`, money-absence
  queries) instead. A `workshop` grep count is not the size of this net in either
  direction.

  The residual risk in a reskin is therefore real but narrower than "the server is
  untested". It is that the absence assertions are **per-surface**, and so cover
  only the surfaces that exist today: `traveler-document.test.tsx`,
  `production-view.test.tsx`, `quote-detail.test.tsx`, `orders-list.test.tsx` and
  `summary.test.tsx`, plus `nav-shell.test.tsx` and `nav-registry.test.ts` which
  assert role gating rather than money absence. A **new or reskinned** screen
  inherits none of them, so it can surface a price on a surface no test is
  watching. The requirement follows directly: **every new or reskinned
  price-blind surface ships with its own money-absence assertion, in the same
  slice that builds it.** That is the owed work — not writing server-side
  price-blindness tests, which already exist.

- **Legal fixtures.** VAT presentation, the §92e reverse-charge legend
  (ADR 0112), the immutable quote snapshot and its reproducibility (I3), the
  frozen nabídka document. The canvas's printed nabídka carries a footer reading
  "Ceny jsou uvedeny včetně DPH 21 %" over a table whose _line items_ are ex-VAT
  under a `Cena bez DPH` header — though the table does also carry a `DPH 21 %` row
  and a VAT-inclusive `Celkem k úhradě`. The footer sentence is therefore an
  imprecise **copy** error describing the column rather than the document, and the
  fix is the sentence, not the totals. The legally-correct text governs.
- **The settled brand tokens.** The ADR 0072 / ADR 0111 decisions — copper as the
  single opt-in accent, ink as `--color-primary`, flat-matte with no glass,
  spotlight scoped to metric cards, `warning` and `deviation` kept on separate
  planes — are not reopened. The canvas was authored against them and honours
  them.
- **3D scene contents.** Design owns the chrome and the HUD around the viewport —
  the dimension chip, the view switch, the tool dock, the watermark, the framing.
  It does not own what is inside the scene. The canvas's `GateElevation` is an
  explicit schematic placeholder; the real geometry comes from the release model
  through the engine and the R3F walker, and the standing rule that geometry is
  verified by eyes on an actual render (not by math or tests) is unchanged.

### 4. The authority inversion: the implemented UI carries none

This is the part that must be stated plainly, because it inverts the usual
default. **The existing implemented UI, its routes and its layouts carry no
design authority.** They are not a baseline to be preserved, respected, or
migrated from. Where the canvas and the shipped screen differ, the canvas is
right by construction — the shipped screen was never designed, so there is
nothing on its side of the comparison to weigh. Surfaces are replaced
**surface-by-surface**, not adjusted.

The constraint on that replacement is **preserved logic**, and it is narrow but
absolute. The existing-screens probe found that only the _markup_ is throwaway;
the surfaces are architecturally sound in three layers, and the outer two are
design-agnostic. Redesign must not lose:

- **Engine wiring.** The configurator's compute path (`derive.ts`, the
  `deriveForUi → resolveUi → buildFlow → encodeConfig` memo chain, the `?c=`
  config-hash round-trip that ties to I3, the `setValue` delete-on-undefined
  semantics that hand a cleared value back to the engine default, the R3F → SVG
  elevation → notice fallback ladder, and the ~1,500 lines of tested pure
  geometry under `scene/`). Two notes for anyone reskinning this surface. First,
  `wizard-flow.ts` hard-codes a five-step Czech spine and the canvas draws seven;
  that step model must be settled against the canvas **before** anyone edits it,
  and the `configurator.step*` i18n keys move with it. Second, the configurator's
  drawing fallback renders `WorkshopDrawingSvg` (the older ADR 0077 shape), **not**
  `TechnicalDrawingSvg` (ADR 0108, which lives under quotes production, the traveler
  and `/drawing-lab`) — so the ADR 0102 dimension model is _not_ already available
  on the configurator's Výkres tab, and wiring the canvas board to the wrong
  renderer is a live trap.
- **Data fetching.** The `lib/*-queries.ts` factories, the RSC prefetch →
  `HydrationBoundary` → identical `queryOptions` in the client leaf shape, the
  in-process server client, and the explicit degradation ladder
  (`isUnauthorized` / `isForbidden` / `isNotFound` swallowed deliberately rather
  than thrown). None of this is touched by a reskin.
- **Form logic.** The customer form's `toDefaults()` / `toInput()` mapping with
  its empty-string→`null` and `country: "CZ"` semantics, the ARES/VIES lookup
  wiring and its mod-11 gate, the dual create/update mutation split, the
  `useDeferredValue` search debounce keyed per committed term, the
  optimistic-update-with-chained-rollback in the projects list, and the
  per-attempt idempotency key minted **inside** the submit handler.

Three patterns carry into all new markup unchanged: fail-closed role gates,
per-attempt idempotency keys, and post-mount `window` access on RSC-hydrated
components (the `BuyerLinkPanel` origin effect exists because inlining
`window.location.origin` during render crashes SSR).

Sequencing follows least-coupled-first: `orders` (smallest, and it exercises the
shared production-view coupling, since `app/orders/[id]/production/` imports
`ProductionView` and `TravelerDocument` from the quotes folder — one component,
two entry points), then `quotes`, then `projects` and `customers` in parallel,
then `configurator` once the step-spine question is settled. `app/page.tsx` and
the skeleton demo components around it are genuine greenfield.

### 5. Where the canvas is silent, fill in its spirit and record it

The canvas draws populated happy paths. Across all nine boards it draws almost no
loading, skeleton, empty, error, offline, in-flight, or failed-submit state; no
transitions between frames beyond the one fullscreen toggle; no onboarding; no
expired-quote, already-accepted, or double-submit handling; and no treatment for
the repo's own "empty-but-honest" posture (ADR 0063 — no active price table means
a notice, not a zero). It also leaves genuinely open questions on the record: the
seven-vs-five step count, the never-drawn BOM view, the margin-floor breach state
that is coded but unrendered, the undrawn intermediate breakpoints, and the fact
that the rail every internal frame draws names destinations (Nabídky, Nastavení)
for which the export contains no frame at all.

Those gaps are **filled in the canvas's spirit and recorded in
`design/README.md`** as they are decided. That file is a companion artifact of this
ADR, written in the same wave; it exists now and is the running record. The rule is
that a filled gap must not diverge in look — a loading state for a canvas-designed
screen is drawn from the same tokens, the same kit, the same density and the same
voice as the frames around it. `design/README.md` records what was filled and why,
so the next implementer inherits the decision rather than re-inventing it. It is a
decision log for design gaps, not a status log, and it lives in the repo because it
is coupled to the code that implements it.

Note for implementers filling the loading/error gap specifically: route-level
boundaries already exist (`apps/web/app/loading.tsx`, `error.tsx`,
`global-error.tsx`, `not-found.tsx`). What is missing is the per-surface composite —
the skeleton that matches _this_ screen's layout — not the boundary itself.

### 6. The composition mandate

Every component, layout, page and atom built in this wave is built with the
`vercel-composition-patterns` discipline loaded, per Martin's standing mandate
(2026-07-20) and consistent with ADR 0111 §3:

- **Compound components over boolean-prop proliferation.** The pattern to copy is
  `Field` and `StatCard` — a root that mints ids and state, parts attached via
  `Object.assign`, a `React.use(Context)` guard that throws a branded message
  outside the root. Note that this is not yet uniform across the kit:
  `SegmentedNav` ships two separate named exports rather than attached parts, so it
  is a compound _in spirit_ but not in shape. New components follow the
  `Field`/`StatCard` shape.
- **Children and slots over config props.** The kit's own counter-examples are
  the specification: `StepNav`'s `steps: {id, label: string}[]` array admits no
  icon, badge or node and had to be forked mentally for every canvas step rail;
  `SegmentedNavItem` takes a `label` prop and renders `{icon}{label}` after the
  props spread, so `children` is ignored; `Toast` pairs `actionLabel` with
  `onAction` and so admits exactly one action. New components do not repeat this.
- **Context only where state is genuinely shared** — selection in a segmented
  control, field identity across label/control/error — never as a general prop
  bus. Concretely, table row selection comes from a table-level selection context,
  never from a per-row `selected` + `onSelect` prop pair, which is exactly the
  boolean-plus-handler shape this rule bans.
- **No shadcn/ui.** The kit is ours.
- **Right-first-time. No refactor pass is budgeted.**

The canvas will demand primitives the kit does not have. The ui-kit probe names
the blocking set: a `Table` compound (seven app files already hand-roll raw
`<table>`), a `DataTable` layer with sortable headers and row selection, a `Card`
compound (or `Panel.Header/Content/Footer` — every list row and dashboard tile
currently re-invents its own padding), a `DropdownMenu` for row actions, a real
`Pagination` (the existing `Pager` has overridable labels and a position readout,
but no cursor awareness, no page size and no "showing X–Y of Z"), and a
`Toolbar`/filter-bar. Beyond those: `Combobox`, `Avatar`, `Accordion`, `Progress`,
a persistent inline `Alert`, `Breadcrumb`, chart primitives, and a `DatePicker`.
Each is built to the mandate, in `packages/ui`, **domain-agnostic**.

The ownership rule is: domain-agnostic primitives go to `@repo/ui`; anything
carrying CPQ vocabulary stays in `apps/web` app-land — exactly as `ExprField` did in
ADR 0068. So the domain chrome the canvas invents (`CommercialPanel`,
`DimensionPill`, `MarginFloorMeter`, `ProductFamilyCard`, `MoneySplit`, `FunnelBar`,
the icon set) is app-land. One correction to an earlier reading: **`SceneViewport`
already exists** in app-land at `apps/web/app/configurator/scene/scene-viewport.tsx`
and is the live configurator 3D boundary (a lazy `next/dynamic` R3F wrapper with an
invalid/loading note), consumed by `configurator-client.tsx`. The canvas's viewport
chrome **grows that component**; it does not create a new one, and creating a second
`SceneViewport` would silently clobber a working boundary.

### 7. The prerequisite slice, and what "done" means for it

The token work in §2 lands **first**, as one slice, before any surface is
reskinned. Its acceptance criteria are the following, and the slice is not done
until every one is met.

**7.1 — The spacing scale.** Twelve rungs on a 4px base with 2px half-steps through
the dense low range, derived from the measured `gap:` distribution in the canvas
(which clusters at 4/6/8/10/12/14/16, with 2/3/5/7/9/11 reading as noise between
rungs): `--spacing-3xs` 2px, `--spacing-2xs` 4px, `--spacing-xs` 6px,
`--spacing-sm` 8px, `--spacing-md` 10px, `--spacing-lg` 12px, `--spacing-xl` 14px,
`--spacing-2xl` 16px, `--spacing-3xl` 20px, `--spacing-4xl` 24px, `--spacing-5xl`
28px, `--spacing-6xl` 32px. The snap rule for implementers reading a canvas frame:
2→`3xs`, 3/4→`2xs`, 5/6/7→`xs`, 8/9→`sm`, 10/11→`md`, 12/13→`lg`, 14/15→`xl`,
16/18→`2xl`, 20/22→`3xl`, 24/26→`4xl`, 28→`5xl`.

**7.2 — The body-type ramp.** The canvas's 23 distinct font sizes collapse to
eleven rungs, each with a line-height: `--text-2xs` 10px, `--text-xs` 11px,
`--text-sm` 12px, `--text-base` 13px, `--text-md` 14px, `--text-lg` 15px,
`--text-xl` 16px, `--text-2xl` 18px, `--text-3xl` 20px, `--text-4xl` 22px,
`--text-5xl` 28px. Every half-pixel rung collapses down to the rung below it
(10.5→`2xs`, 11.5→`xs`, 12.5→`sm`, 13.5→`base`, 14.5→`md`, 15.5→`lg`), and 17→`xl`,
19→`2xl`, 21→`3xl`, 23/24→`4xl`, 26/30→`5xl`. These sit **below** the existing
editorial `--text-title` (32), `--text-metric` (40) and `--text-display` (96), which
are unchanged — there is no collision.

**7.3 — The interaction-state layer.** States are **derived, not hand-authored per
theme**, because a hardcoded lighten/darken direction is wrong in one of the two
themes. Each state token mixes its base toward `--color-foreground`, which already
inverts per theme, so one declaration in `@theme` is correct in both and no dark
counterpart is needed. The ladder is **hover at 88%, active at 78%**, and disabled
is opacity-shaped rather than hue-shaped (`--opacity-disabled: 0.45`). The set
covers `primary`, `secondary`, `chrome`, `nav-active`, `destructive`, `success`,
`warning` and `info`. **`--color-copper-hover` is the one exception and stays
hand-authored**: its existing light and dark values are deliberately tuned for the
brand CTA, and although they already run in the mix-toward-foreground direction,
replacing them with the derived value would regress a considered choice.

**7.4 — The dark-variant fix.** `theme.css:156` `@variant dark {` → `.dark {`, and
the `@custom-variant dark (&:where(.dark, .dark *))` declaration moved into
`theme.css` so no compile entry can omit it. The bundle is then regenerated per
`.design-sync/NOTES.md` and its dark layer verified to carry a real selector.

**7.5 — The design-sync preflight.** The scripted preflight decided in §1 —
one command that copies `tooling/tailwind-config/theme.css` to
`packages/ui/.ds-css/theme.css` and runs the Tailwind compile, so both `tokensGlob`
and `cssEntry` derive from source in the same action. Plus the entry-import guard in
one of the two executable forms decided in §1: either run the assertion that
`.design-sync/tailwind-entry.css` imports the canonical `theme.css` **inside the
preflight**, where that untracked directory is present, or commit `.design-sync/`'s
durable subset first and then assert it from a tracked test. The slice must not ship a
guard written as though `.design-sync/` were checkable in a fresh clone — it is
git-excluded, and such a check would skip silently and enforce nothing, which is the
failure mode this section exists to prevent.

**7.6 — The acceptance artifact.** Per Martin's standing rule that a render is
verified by eyes on the render and never by math or tests alone, the slice's
acceptance artifact is a **headless capture of `/brand-lab?theme=dark`** — taken
with the existing capture tooling, read back, and confirmed to show a fully flipped
surface rather than the half-flip described in §2. `/brand-lab` must additionally be
**extended to display the new spacing and interaction-state tokens**; adding
vocabulary with no eyes-on surface would repeat the discoverability failure that
made the canvas improvise in the first place. The light capture is taken alongside
it as the no-regression control.

## Consequences

- **Adoption is free at the token layer.** No migration, no mapping, no
  dual-vocabulary period. The one system in `theme.css` + `packages/ui` is what
  the canvas already speaks.
- **But the token pipeline is not yet trustworthy, and this ADR does not pretend
  otherwise.** The `theme.css` → `.ds-css/theme.css` copy is unenforced, and its
  failure mode is silent and inverted — a stale copy makes the sync report "no
  change" rather than reporting nothing. Until §7.5 ships, **assume the design-sync
  ledger cannot see token drift**, and run the copy by hand before every sync.
- **The additive work is real and must land first.** The spacing scale, the
  body-type ramp, the interaction-state layer, the dark-variant fix and the sync
  preflight are prerequisites with the acceptance criteria in §7 — without them
  every new screen re-improvises the same ~700 hardcoded values the canvas frames
  did, dark mode stays broken on the eyes-on route, and the exported bundle keeps
  shipping a dead dark layer.
- **The surface area is large.** Nine boards, roughly thirty frames, five
  viewports, across every surface in the product plus several that do not exist
  yet. This is a wave, not a slice, and it will be paid over many sessions. The
  per-surface sequencing in §4 exists so each payment is independently shippable.
- **The canvas does not cover every state.** Loading, error, empty, in-flight,
  transitions, onboarding and edge flows are all owed, on top of the drawn work.
  Estimating from the frames alone will underestimate. Two rail destinations the
  canvas itself names — Nabídky and Nastavení — have no frame at all and are owed as
  design, not just as implementation.
- **The leads domain has no backend at all.** Two of the nine boards — the public
  lead-catcher (desktop and phone) and the leads inbox — sit on a domain that
  does not exist: no module, no table, no validator, no route, zero hits for
  `lead`/`poptáv` anywhere in `apps/api`, `packages/db` or `packages/validators`.
  Those surfaces are a full vertical build (schema, module, endpoints, public
  unauthenticated submission with its own rate-limit and anti-spam posture,
  org ownership for an anonymous lead), not a reskin. The `customers` module
  (ADR 0082) is the nearest pattern to model them on. Likewise the dashboard:
  there is no aggregate endpoint anywhere, and the keyset-paginated list
  endpoints carry no totals, so `Přehled` needs a purpose-built endpoint before
  it can render anything real.
- **The price-blind invariant is the one hard tripwire, and its gap is per-surface,
  not per-layer.** The reskin's largest concrete risk is reintroducing money into a
  workshop-reachable surface while following canvas boards drawn for the owner. The
  layer that actually enforces the rule — the ADR 0056 server-side price-blind DTO —
  **is covered**, at the unit level (`production.test.ts`,
  `quotes.service.spec-rows.test.ts`) and at the HTTP level (`roles.itest.ts`,
  `quotes-production.itest.ts`), with the citations in §3. What is thin is not that
  layer but the **per-surface** client assertions, which exist only for the surfaces
  built so far and are inherited by nothing. A new screen is therefore unwatched by
  default. The standing requirement is consequently narrow and enforceable: every new
  or reskinned price-blind surface ships its own money-absence assertion in the same
  slice that builds it. No server-side price-blindness backfill is owed.
- **Taste review stays a human gate that never blocks the build.** Exact copper
  against a lit render, motion timing, density — these remain owed to Martin, and
  `/brand-lab` plus the headless captures are the artifact for that review. Per
  ADR 0111 the review is a render pass, not a gate: implementation proceeds, the
  captures accumulate, and Martin's corrections land as adjustments rather than
  as a hold on the wave.

Related: ADR 0111 (the design system this applies, and the `.ds-css` staleness
hazard this ADR finally schedules a fix for), ADR 0072 (the brand foundation),
ADR 0078 (the typeface trio), ADR 0004 (the shared token file), ADR 0056
(price-blindness by absence), ADR 0063 ("empty-but-honest"), ADR 0068 (the
app-land vs domain-agnostic-kit boundary this repeats), ADR 0076 (the deviation
model behind the canvas's `Odchylka` pill), ADR 0077 / ADR 0102 / ADR 0108 (the two
drawing renderers the configurator and the traveler use respectively), ADR 0087
(print via `window.print()`, no PDF dependency), ADR 0109 (the order domain the
canvas's order boards must be adapted to), ADR 0112 (the tax seam the nabídka
boards must not contradict); companion artifact `design/README.md`; vault
[[Decision — enterprise-readiness gap analysis & phased roadmap]].
