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
Next: step-6 follow-ups (ADR 0063 shipped new-org default **release assignment**;
default price-table **rejected**) — release version-pin / opt-in-upgrade UX,
per-release catalog (mixed-version), admin (`adjustability: tenant`), issue-key
i18n + deviation-override UX, `/site`↔`/configurator` convergence; then ADR 0058
deferreds (sticky last-active org, Decline / web self-registration).
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
- **PII columns must use `pii()`** from `@repo/db/columns` — the registry
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
