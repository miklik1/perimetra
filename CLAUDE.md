# CLAUDE.md — agent operating manual

Canonical agent instructions for this repo (tool-neutral despite the
filename; `AGENTS.md` points here). Read this before changing anything.
TypeScript fullstack monorepo: NestJS 11 (Fastify) backend + Next.js 16 web +
Expo SDK 56 mobile, stamped from `fullstack-skeleton` (ADR 0042; `skeleton`
git remote = upstream channel A). Skeleton conventions are the product — when
in doubt, copy the reference module, don't invent.

## What this repo is — the Perimetra enterprise rebuild

A vertical CPQ where **product knowledge is data, not code**: a generic engine
interprets immutable, vendor-authored **Product Model Releases**. The founding
contract is **`docs/rebuild/CORE_SPEC.md`** (read it first for anything touching
the core); cross-cutting strategy/decisions live in the vault
(`10 Projects/Perimetra/`), not here. The rebuild core:

| Path                 | What it is                                                                                                                                     |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/model`     | Schema types + the **Expr DSL** (parse/evaluate). Pure, zero internal deps. The published contract.                                            |
| `packages/engine`    | Generic interpreter: cascade → constraints (swappable evaluator) → derivation → emit. **Pure** (no I/O — the calc-engine discipline, widened). |
| `packages/renderers` | Cut list / 3D scene / 2D drawings as **pure data** off (Site, SiteResult) only (I4). Presentation (R3F/SVG/PDF) is app-land.                   |
| `packages/fixtures`  | Authored releases + golden corpus + the **delta-0 proving harness** (test-only; consumes model+engine+renderers).                              |

Build order is CORE_SPEC §10. **Step 6 slices 1–3 + 3c done** (slice 3 = the
quote-lifecycle I3 core; 3c = project persistence). Slice 1 (2026-06-12,
ADR 0051): generated configurator — `UiSpec` + `ParameterDef.label` are release
data validated at publish; `resolveUi` in `@repo/model`; the wizard at
`apps/web/app/configurator` renders from release data alone, engine runs in the
browser, R3F walker over `Scene3D` is app-land with Euler order "ZYX". Slice 2
(2026-06-13, ADR 0052): the site canvas at `apps/web/app/site` (`/site`) — the
generated surface at site scope: place/connect/drag instances on a 2D plan +
the multi-instance 3D viewport + aggregate site BOM/price; two-truths derive so
per-instance footprints stay editable when a connection/terrain failure
invalidates the whole site (`SiteBomLine.totalPriceMoney` closes the per-line
I10 boundary). Slice 3 (2026-06-13, ADR 0053): quote lifecycle I3 core —
immutable global `release`/`catalog_version` stores + per-tenant versioned
`price_table`s (effective-date `resolveActive`) + a `quotes` module whose
`issue` runs the pure `deriveSite` **server-side** and freezes a stamped,
re-derivable snapshot; `verifyReproducibility` re-derives byte-identically from
the stamps (I3 acceptance, golden `129891.504`). To run the engine server-side,
`@repo/model`/`engine`/`renderers`/`fixtures` became **built (NodeNext dist)**
packages (were source-only). New modules are owner-scoped (ADR-0041 interim).
Slice 3c (2026-06-13, ADR 0054): project persistence — a project owns its site
as `project.site` (opaque JSONB) + a `project_instance` roster table
(`{instanceId, releaseId, input, overrides?}`, mirrors the quote roster so a
saved project is issue-ready); full-document `GET/PUT /projects/:id/site`
(transactional, ownership-gated, audited); `/site`→`/site/:projectId` loads via
RSC + saves explicitly; `app/site/persistence.ts` is the sole `releaseId↔product
index` bridge. `@repo/fixtures` is still the ⌛ interim web **release/catalog**
source via `app/configurator/products.ts` (`app/site/initial.ts` demoted to the
"Load demo" populate) — retiring it = the admin-publish slice (api-served
catalog). Slice 3f (2026-06-13, ADR 0055): org-scope activation — the ADR 0041
tenancy seam went LIVE. Better Auth `databaseHooks` auto-provision one org +
owner membership per user and stamp every session's `activeOrganizationId`
(no switcher UI; self-serve org create stays off); `RequestScope.organizationId`
is now required (`@CurrentScope()` 403s an org-less session); `scoped()` in
projects/quotes/price-tables flips owner→org (`ownerId` kept as creator/audit);
`organization_id` NOT NULL + hot indexes re-keyed owner→org + price-table version
unique per org; the immutable I3 stores (quote, price_table) get `owner_id` +
`organization_id` ON DELETE RESTRICT (I3 durability; GDPR erasure anonymizes the
user row, never deletes — so RESTRICT holds); `org:<id>` realtime channel
unlocked for the session's active org. Steps 1–5 shipped before (ADR 0045–0050).
Roles slice (ADR 0056): membership-scoped RBAC (admin/sales/workshop on
`member.role` + `RolesGuard` + workshop price-blind DTO + margin-floor guard +
admin publish gate). Org invite/sharing slice (2026-06-15, ADR 0057): multi-member
orgs are reachable through the UI — the Better Auth org plugin owns the invite/
accept/member lifecycle (endpoints at `/api/auth/organization/*`, NO `/v1/*`
module); custom `ac` roles gate it (owner/admin can invite, sales/workshop can't),
**duplicated** server (`modules/auth/org-access.ts`) ↔ client (`@repo/auth`
`permissions.ts`) — same precedent as the `OrgRole` tuple, kept in lockstep;
invite email via the email module; session hook now stamps a DETERMINISTIC active
org (prefers the owner membership); web `/team` (roster, admin invite/role-mgmt,
org switcher) plus `/accept-invitation/:id`. Wart: every user still gets a
personal auto-org, so an invitee carries a dead org and lands there on login
(switch per session) — onboarding fix deferred (fixed by ADR 0058). Cost-model
slice (2026-06-15, ADR 0059): pure engine cost layer (recipe re-evaluated against
a co-located `price_table.cost`), real `(price−cost)/price` margin + per-org
floor, retires the `QUOTE_MARGIN_FLOOR_PCT` proxy. Admin-publish slice
(2026-06-16): **api-served catalog** (ADR 0060) — the web reads releases/catalog/
active-price-table from the api (an RSC `fetchCatalogBundle` prop-passed into the
configurator/site; engine still client-side), `initialInput` is gated publish
metadata on the release row, a standalone `apps/api/src/seed.ts` publishes the
golden corpus via the services (idempotent, setup.mjs step); **retires the ⌛
`@repo/fixtures` web runtime source** (now web test-only). Plus the **admin
publish UI** (ADR 0061): admin-gated `/admin` (JSON paste for catalog/release,
structured price-table form, renders I2 `defects[]`). Workshop is price-blind by
absence (403 on `/price-tables/active` → notice, not the engine). Per-tenant
release visibility (2026-06-16, ADR 0062): **vendor-assigns via a platform actor**
— Better Auth `user.role='admin'` wired as a `PlatformGuard` (resolved fresh per
request, like `RolesGuard`); authoring (release/catalog **publish**) retiered
org-admin→**vendor-only** (CORE_SPEC §3); a new `org_release_assignment(org,
releaseId)` join (soft natural-key ref, disposable — owned by the releases module)
filters the tenant `GET /v1/releases` to assigned-only (and `/:id` 404s an
unassigned one — no body leak); quote `issue` gates on assignment (defense-in-depth)
but re-derivation does NOT — **I3 ≠ visibility** (a quote on a since-unassigned
release still reproduces `129891.504`); `/v1/platform/*` vendor console (assign/
unassign/list orgs) + web `/platform` (publish moved off `/admin`, which keeps
price tables). Seed promotes `PLATFORM_ADMIN_EMAIL` + assigns the corpus to seeded
orgs; a fresh org starts with NO assignments (vendor assigns explicitly).
New-org default provisioning (2026-06-16, ADR 0063): a genuinely-new org is
auto-assigned the **vendor-configured** default release set (`PLATFORM_DEFAULT_RELEASE_IDS`
env list) at provision time — wired into the Better Auth `session.create.before`
hook via a mutable `OrgProvisioningHook` registry that lives in the (leaf) auth
module, so AuthModule never imports ReleasesModule (the `OrgProvisioningModule`
registers the closure on init); fail-soft + idempotent + CLS-wrapped per assign.
**No default price-table** — "empty-but-honest": a fabricator's prices are their
own data, so the configurator degrades to a notice until they publish (the
vendor-starter-layer option was considered and rejected).
Release version-pin / opt-in-upgrade (2026-06-18, ADR 0064): the §3 "pin + explicit
opt-in" half. New `org_model_pin(org, modelId, pinnedReleaseId)` (active version per
model — SEPARATE from the ADR-0062 assignment join = availability); `assign` lazily
pins the first assigned version + a NEWER assigned version becomes an "upgrade
available" offer (never silently moves the pin); `GET /v1/releases` is now
PINNED-only (configurator shows one version per product, which also shrinks the
mixed-catalog blast radius); tenant admin opts in via `POST /v1/releases/pin` (+ `GET
/v1/releases/upgrades`), single-catalog pre-flight 422s `upgrade_catalog_conflict`.
`assertAssigned` stays **set-membership** (the pin governs the default offer, not
authz — a still-assigned old version is quotable); **I3 ≠ pin** (a quote on @1
reproduces forever after opting into @2). `/platform` console groups by model +
badges the pin; migration backfills pins to the highest assigned version (N-1 safe).
Per-release catalog (2026-06-18, ADR 0065): the mixed-version fix behind ADR 0064's
`upgrade_catalog_conflict` guard. `deriveSite` now takes a `ReadonlyMap<releaseId,
Catalog>` (each instance derives against its OWN pinned catalog — the engine was
already per-instance); `SiteStamps.catalogVersion` scalar → `catalogVersions`
map; `quote.catalog_version` denorm DROPPED (authoritative copy in
`stamps.catalogVersions` JSONB). Deleted the three single-catalog guards
(`mixed_catalog`, `upgrade_catalog_conflict`+`catalogConflict`, the web throw) —
they refused a now-legal state; `MissingCatalogError` is the new structural I5
backstop. `pinVersion` is now a pure version move (no catalog pre-flight). I3 holds
across mixed catalogs (`per-release-catalog.itest`: a catalog@1+@2 quote reproduces).
Vendor-broadcast upgrade-offer fan-out (2026-06-18, ADR 0066): the LAST piece of the
§3 release lifecycle. One platform action (`POST /v1/platform/releases/:id/broadcast`)
makes a release available to **every org pinned to an older version of its model**
(server-derived `findOrgsBehindOnModel` = `org_model_pin ⋈ release` on a `version <`
compare) → each gets an opt-in upgrade offer. NEVER moves a pin: reuses the single-assign
write path (`assignValidated` → `ensurePin` ON CONFLICT DO NOTHING), so it's structural,
not a guard. Validate-once + per-org-isolated tx + idempotent; per-org errors propagate
(a concurrent org-delete FK-abort is benign + idempotent-retry-recoverable). `assign()`
returns the inserted flag; additive `org_model_pin(model_id)` index. So the release
lifecycle is now complete: assign → lazy-pin → tenant opt-in → vendor broadcast.
Release retire + platform detail-read (2026-06-19, ADR 0067): the §3 end-of-life
transition. `POST /v1/platform/releases/:id/retire` (vendor-only) flips
`published`→`retired`; **NON-STRANDING** — a retired release stops being OFFERED for
new work (not assignable/broadcastable/pinnable — reuses the existing non-published
guards — and dropped as an upgrade TARGET in `getUpgradeOffers`) but an org already
PINNED to it keeps configuring (the configurator list is NOT status-filtered; the
vendor's lever to move tenants off is publish-a-fix + broadcast, not a cutoff). **I3
untouched**: body never mutated, row NEVER deleted, `loadByReleaseId`/`assertAssigned`
status-agnostic, so a quote on a since-retired release reproduces forever. Idempotent

- race-safe (conditional `UPDATE … WHERE status='published' RETURNING`; HTTP 200 every
  path, like `verify`). Plus the GLOBAL `GET /v1/platform/releases/:id` (no assignment
  gate, so the operator can inspect any release the tenant `/:id` would 404) + account-page
  nav links to `/admin`·`/platform` (role/`isPlatformAdmin`-gated, fail-closed). No schema
  change (`retired` already existed). So §3 is end-to-end: publish → assign → lazy-pin →
  opt-in → broadcast → retire.
  Structured release editor — Phase 1 (2026-06-19, ADR 0068): the raw-JSON release publish
  form on `/platform` is RETIRED for a **model-IDE** at `/platform/releases/new` (navigator +
  rule-table workbenches + always-on defects dock). The keystone is **zero-drift Expr
  authoring**: `validate.ts`'s per-slot scope construction was extracted into a pure exported
  `slotScopes(release): Map<where, ExprScope>` that `validateRelease` itself now CONSUMES
  (one source of scope truth), so the editor's autocomplete/ref-check can't drift from the
  publish gate (`tokenize` + `EXPR_FUNCTIONS` also exported). Live in-browser `validateRelease`
  (ADR 0051) drives per-field defects + nav badges; the `ExprField` (live parse + in-scope
  autocomplete + ref/fn check) lives in app-land (`@repo/model`-coupled; `@repo/ui` stays
  domain-agnostic — gained `FieldShell`/`EnumSelect`/`DisclosureSection`/`ArrayField`[first
  `useFieldArray`]/`NavTree`/`DefectList`). **Hybrid completeness:** structured forms for
  identity/parameters/constraints/derived + **validated raw-JSON islands** for the not-yet-
  structured sections (option sets, parts/BOM/geometry, ports, terrain, ui) → a COMPLETE
  release is authorable today. Publish goes through the EXISTING immutable `POST /v1/releases`
  (no second freeze path, I3 untouched). The `where`↔fieldId bijection is a tested layer
  (validator addresses by key/path, RHF by index). Behavior-preserving model refactor (full
  gate + integration 16/90 green; goldens reproduce).
  Structured release editor — Phase 2 (2026-06-21, ADR 0068): the **parts/geometry** raw-JSON
  island is RETIRED for a structured **master-detail** workbench (`PartsWorkbench` = an
  `ArrayField` of collapsible part cards — new empty part opens, existing collapse to a master
  list — each with identity/resolve/bom + a NESTED geometry `ArrayField`: `length`/`at[3]`/
  `rotation[3]`/`cuts`/`repeat`, every Expr slot an `ExprField`, `repeat.var` flowing into
  autocomplete because `slotScopes` models it). The `where`↔fieldId bijection gains the
  parts/geometry builders (keyed by part `path` + geometry `key`, pinned to `slotScopes` both
  directions). **Catalog-aware pickers:** `resolve.role` = a `<datalist>` of the catalog's
  component roles; `resolve.section`/`material` stay `ExprField` (one zero-drift Expr path) but
  gain catalog section/material CODES as quoted-literal completions (`codeCandidates`, quote-
  adjacency-aware); the identity catalog field becomes a published-version SELECT. **The editor
  now passes the loaded catalog to `validateRelease(release, catalog)`** so `catalog.*.unknown`
  defects match the server gate live (degrades catalog-less). Backend (2A): `GET
/v1/platform/catalog-versions` + `/:id` on `PlatformController` (`PlatformGuard`, no org gate,
  mirrors ADR 0067 global read; reuses `CatalogVersionsService`; `PlatformModule`→
  `CatalogVersionsModule`); NO schema change. Built on the SAME Phase-1 `@repo/ui` primitives
  (kit stays domain-agnostic; only `ExprField` grew `codeSuggestions`). Publish stays the
  immutable `POST /v1/releases` (I3 untouched). Full gate + integration 17/94 green; goldens
  129891.504/79039.86 reproduce.
  Structured release editor — Phase 3 (2026-06-22, ADR 0068, `bde1dc8`→`99b0304`): the
  **draft + iterate** loop so a vendor authors safely without publishing. **3A** = a new MUTABLE,
  **org-scoped, vendor-only** `release_draft` store (`/v1/platform/release-drafts` CRUD,
  `SessionGuard`+`PlatformGuard`; `body` holds the editor form state opaque — drafts are
  legitimately incomplete, only the publish gate validates; `modelId`/`version`/`catalogVersion`/
  `baseReleaseId` denorm for the list/clone/diff; autosave PATCH is un-audited/non-tx
  working-state churn, create/delete audited; privacy handler; NO outbox/realtime). **3B** =
  `useDraftAutosave` (debounced `form.watch`, create-once→PATCH, `history.replaceState` to
  `/drafts/[id]`, serialized+coalesced, unmount-cancels) + resume list `/platform/releases/drafts`
  - `/drafts/[id]` + a header save badge; publish discards the draft. **3C** = `draftFromRelease`
    (faithful inverse of `buildReleaseFromDraft`; `ExprString` is a branded string so source =
    `String(e)`) + a "Clone" console action → draft at version+1 (carries `baseReleaseId`) → publish
    a NEW `modelId@version` via the immutable path. **3D** = `GET
/v1/platform/releases/by-release-id/:releaseId` (natural-key global read reusing `loadByReleaseId`)
  - `diffRelease(base,current)` (keyed by business key, islands whole, version bump separate) +
    a "Changes vs {releaseId}" editor dock panel. Publish stays the immutable `POST /v1/releases`
    (no second freeze, I3 untouched); clone+freeze are client-side, so the new module is pure CRUD.
    Scaffolded via `pnpm gen module` then adapted (the template is STALE post-ADR-0055 —
    owner-scoped; flipped to org-scoped). NO schema change for 3B–3D. Full gate + integration
    19 files/104 green; goldens reproduce. (Also fixed an OpenAPI snapshot stale since Phase 2A.)
    Structured release editor — Phase 4 (2026-06-22, ADR 0068, `e627253`→`23a3e30`): the **live
    engine + power features** — the editor is now COMPLETE. All client-side + pure (no backend;
    I1/I3/I5 untouched). **4A** = an engine **web worker** — the validate pipeline
    (`buildReleaseFromDraft`→`slotScopes`+`validateRelease`) moved off the main thread; pure compute
    in `lib/release-engine.ts` (`runReleaseValidation`, worker-agnostic + tested), thin
    `release-engine.worker.ts` pump; catalog cached worker-side, each `validate` tagged with a
    monotonic id → **last-write-wins**; `useReleaseValidation` degrades to a synchronous fallback
    when no `Worker` (SSR/jsdom/bundler miss), exact-parity public shape. Bundles under Next 16 via
    `new Worker(new URL(…, import.meta.url), {type:"module"})`. **4B** = a dock **Preview tab** —
    derives the in-progress release on a sample input (`deriveInstanceDetailed` in the SAME worker)
    → resolveUi wizard + BOM/price + typed Issues (I5), rendered with the configurator's own
    `ParamField`/`ResultsPanel` (no second design) + a cost/real-margin line (ADR 0059). Needs a
    catalog AND a price table (a missing component price is an I5 error, not a zero — no honest
    "BOM without prices"); the worker lifecycle is the shared `useEngineWorker`. **4C** = `ExprField`
    power — a **character-faithful syntax overlay** (app-land `highlightSpans`, a COSMETIC lexer:
    can't reuse the model's span-less `tokenize`, and a miscolor never affects validation) behind a
    transparent-text input, + an inline **`= value`** per formula evaluated against the live derive
    scope. To feed that scope the live preview is **lifted from the dock to the Editor**
    (`useReleasePreview`+`useActivePriceTable`), provided via `ExprEvalScopeContext` (workbenches
    stay prop-clean); `PreviewTab` is now presentational. Each sub-slice adversarially reviewed (no
    correctness bugs). Full gate: web 17 files/94 + integration 19 files/104; goldens reproduce
    (+ single-gate `81451.504` through draft→preview). NO schema change.
    Phase 0 — enterprise-readiness "stop the bleeding" CLOSED (2026-06-23): editor fixtures island
    (`fixturesJson` raw-JSON island clears the I2 `fixtures.empty` defect in-editor); **mandatory TOTP
    MFA** for the platform operator (ADR 0070 — `twoFactor` plugin + table + `user.twoFactorEnabled`;
    `PlatformGuard` 403s a distinct `mfa_required` until enrolled; `/two-factor` challenge +
    `/account/security` enroll; GDPR erasure purges the credential); + the channel-A skeleton drain
    `bd17852→5326227` (16 fleet hardening fixes — `skeleton.baseCommit` bumped; notable: apiFetch is
    now 204-honest `T | undefined` so raw consumers narrow, precise ICU-arg types so numeric `t()` args
    take `String()`, `safeNextPath` is the canonical open-redirect guard). Earlier Phase-0 slices
    0.1–0.4 (ADR 0054/0055 data-loss, I2, Dockerfile, password/audit ADR 0040) shipped before. ADR 0069
    (identity decouple) stays Proposed — go-gated, NOT implemented.
    Workshop traveler (2026-07-10, ADR 0108): the shop-floor deliverable. The ADR-0102
    technical drawing had **zero consumers** — nothing froze it, nothing rendered it (the
    snapshot and `/production` carried the older ADR-0077 `WorkshopDrawing`, whose only dims
    are `overall.width/height`). Now `artifactsOf` freezes `technicalDrawings` as a TOP-LEVEL
    snapshot key (a sibling of `drawings`: `drawings` is deep-equal-compared, so nesting
    would retroactively break I3 on historical quotes) and `verifyReproducibility` compares
    it only when the frozen snapshot carries it (expand/contract N−1). Frozen `specRows` are
    valued from a **price-free scope** — `buildScope` seeds the price layer, so a parameter
    defaulting to `price.*` printed a CZK rate on the price-blind sheet (proven, now "—":
    absence, not masking). `toProduction` adds `technicalDrawings`/`specRows`/`dimensionRows`
    through structured zod (never `z.unknown()`). Dimension rules gained an optional Czech
    `label`; `TechnicalDrawingSvg` (app-land) is the first `TechnicalDrawing` renderer;
    `/drawing-lab` is the checked-in eyes-on route; `/quotes/:id/production/traveler` prints
    via `window.print()` (zero PDF dep, ADR 0087) off the EXISTING price-blind endpoint.
    Channel-A drain (2026-07-09): skeleton `ba094be`→`1185fe7`; upstream ADRs 0046–0049
    **renumbered** to perimetra 0104–0107 (they collide by number, and land as a silent
    SECOND `00xx-*.md` because the basenames differ — cherry-pick never conflicts).
    Next: **Phase A** (legal-document spine + close the loop) per the vault roadmap
    [[Decision — enterprise-readiness gap analysis & phased roadmap]]. The immutable-PII
    retention posture that used to block it is SETTLED (ADR 0071: Art.17 erasure anonymizes,
    never deletes, so the 10-yr accounting retention holds). The editor (ADR 0068) is DONE.
    Invariants I1–I11 (CORE_SPEC §1)
    are the bar every PR is judged against; the Expr numeric-domain choice is
    ADR 0045, catalog/resolution ADR 0046, error taxonomy ADR 0047,
    cascade/overrides ADR 0048, site graph ADR 0049.

## Package map

| Path                                                        | What it is                                                                                                              |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `apps/api`                                                  | NestJS modular monolith — 3 deployables from one build: `main.ts` (http), `worker.ts` (queues), `migrate.ts` (one-shot) |
| `apps/web`                                                  | Next.js 16 (App Router, RSC); proxies `/api/*` to the api (same-origin cookies)                                         |
| `apps/mobile`                                               | Expo SDK 56 / React Native (Jest, not Vitest)                                                                           |
| `packages/db`                                               | **Built** pkg: Drizzle schema (split per module), `columns` helpers, `pii()` registry, factories, migrations            |
| `packages/validators`                                       | Shared zod (v4) contracts — the api ↔ frontend seam                                                                     |
| `packages/api` / `api-mocks`                                | REST client factory / MSW mocks (mock-mode dev + 3rd-party HTTP mocking in tests)                                       |
| `packages/auth`                                             | Better Auth client wrapper (`useAuth`, `AuthGuard`)                                                                     |
| `packages/config` / `utils` / `store` / `navigation`        | Typed env / helpers / Zustand stores / route contract                                                                   |
| `packages/i18n` / `flags` / `telemetry` / `realtime` / `ui` | ICU catalogs / PostHog flag registry / Sentry+analytics seam / Centrifuge adapter / web+mobile UI                       |
| `packages/ai`                                               | Thin LLM seam: chat/embedding interfaces + router + no-op defaults (provider adapters are per-project)                  |
| `tooling/*`                                                 | Shared eslint / tsconfig / prettier / tailwind / vitest configs; CI setup action                                        |

## Dependency DAG & boundaries (ESLint-enforced — ADR 0008/0011)

- The package DAG lives in `tooling/eslint/base.js` (`boundaries/elements` +
  `boundaries/dependencies`). Apps import packages; packages import only
  their declared deps; cycles are uncompilable.
- **Deep imports are banned.** Only a package's `exports`-map subpaths are
  importable (`no-restricted-imports` allow-list in `tooling/eslint/base.js`
  — keep it in lockstep with `exports` maps; `pnpm gen package` wires both).
- **Api modules own their schema dirs** (ADR 0032): `modules/X/**` imports
  `@repo/db/schema/X` plus shared helpers only. Cross-module reads go through
  the owning module's exported service — never joins across module schemas.
- Each `apps/api/src/modules/*/CONTEXT.md` states what that module may never
  import. Generators maintain `@gen:*` anchor comments — never delete them.

## Commands (run from repo root; node 24 per `.nvmrc`)

| Command                                                         | What                                                                                                                                               |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm run setup`                                                | One-command bootstrap: compose up + install + build + migrate (`scripts/setup.mjs`). `run` required — pnpm's builtin `setup` shadows the bare form |
| `pnpm dev` / `pnpm dev:web`                                     | All dev servers / web only (api dev: `pnpm --filter api dev`)                                                                                      |
| `pnpm build` / `check-types` / `lint` / `test` / `knip`         | The quality bar — ALL must pass before done                                                                                                        |
| `pnpm --filter api test:integration`                            | Testcontainers suite (real pg + redis; needs Docker)                                                                                               |
| `pnpm gen module`                                               | Scaffold a full backend resource (see generator-first below)                                                                                       |
| `pnpm --filter api migrate`                                     | Run migrations (release-phase one-shot; never at boot)                                                                                             |
| `pnpm --filter @repo/db db:generate`                            | Generate a migration from schema changes                                                                                                           |
| `BASE_URL=http://localhost:4000 k6 run loadtest/projects.k6.js` | Load test (k6 is an external binary)                                                                                                               |
| `pnpm format`                                                   | Prettier-write (md/ts/tsx)                                                                                                                         |

Local quirk: gitignored `docker/.env` may remap infra ports (this box:
pg `5433`, redis `6380`) with matching `apps/api/.env.local` overrides. CI
and fresh clones use compose defaults (5432/6379/8000/9000/1025).

## Conventions that bite (the uncompilable / un-reviewable list)

- **ESM NodeNext** in `apps/api` + `packages/db`: relative imports need the
  `.js` extension (`./foo.js`, even from `.ts`). Forgetting it breaks build.
- **Built vs source packages**: `@repo/db` resolves from `dist/` — build it
  (`turbo` handles ordering) before consuming; stale `dist` = stale types.
- **Outbox**: `OutboxService.emit()` THROWS outside `@Transactional()` —
  state change + event row share one transaction, always (ADR 0037).
- **Payloads are IDs-only, never PII** (jobs and outbox events). Processors
  re-fetch. This keeps Redis non-PII-bearing and rebuildable.
- **PII columns must use `pii()`** from `@repo/db/pii` — the registry
  drives GDPR export/erasure AND log redaction. A raw column leaks.
- **Cron = BullMQ repeatables only**; `@nestjs/schedule` is banned (fires
  once per replica). Singleton work: jobId dedup or pg advisory lock.
- **Keyset pagination** by default (UUIDv7 ids); offset is a documented
  exception. **Every endpoint returns through a zod response schema** (strip
  semantics) — unvalidated `select()` shipping `passwordHash` is the leak
  class this kills (ADR 0039).
- **Migrations are expand/contract** and N−1 compatible; `lock_timeout` set;
  run as the release phase, never at app boot (ADR 0038).
- Transaction-pooling-safe by default: no session GUCs, no LISTEN/NOTIFY,
  no prepared-statement reliance.

## Generator-first rule

New backend resource? **`pnpm gen module`** — it scaffolds the full ADR
0039–0041 pattern (contract → controller → `@Transactional()` service →
org-scoped repository → per-module schema → outbox events → worker handler →
privacy handler → tests) and injects into every `@gen:*` anchor. Hand-rolling
gets ~80% of the dance right; the generator gets 100%. `pnpm gen package` /
`api-resource` / `route` likewise for packages, frontend api slices, routes.
The reference implementation is `apps/api/src/modules/projects`.

## Where truth lives

- Spec: `docs/superpowers/specs/2026-06-10-fullstack-skeleton-design.md`
- Plan: `docs/superpowers/plans/2026-06-10-fullstack-skeleton-plan.md`
- Decisions: `docs/adr/README.md` (index; one ADR per decision — supersede,
  don't edit history). Architecture overview: `ARCHITECTURE.md`.
- Operations: `OBSERVABILITY.md` (golden signals, redaction),
  `SECURITY.md` (CSRF stance, throttle tiers, ASVS map, supply-chain gates)
- Per-module: `apps/api/src/modules/*/CONTEXT.md`, `packages/db/CONTEXT.md`,
  `packages/ai/CONTEXT.md`

## Definition of done

`pnpm check-types && pnpm lint && pnpm test && pnpm build && pnpm knip` green,
plus `pnpm --filter api test:integration` when backend behavior changed.
Architectural deviation? Amend the spec and write an ADR — never silently
diverge.
