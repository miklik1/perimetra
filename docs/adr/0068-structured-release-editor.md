# ADR 0068 — Structured release editor + slotScopes() single source of scope truth

**Status:** Accepted (2026-06-19). **Phase 1 shipped 2026-06-19; Phase 2 shipped
2026-06-21; Phase 3 shipped 2026-06-22.** Implements the
**structured release editor** that [ADR 0061](0061-admin-publish-ui.md) and
[ADR 0067](0067-release-retire.md) named as the last deferred step-6 vendor/admin
authoring follow-up. Full design: `docs/superpowers/specs/2026-06-19-structured-release-editor-design.md`;
phased plan: `docs/superpowers/plans/2026-06-19-structured-release-editor-phase1-plan.md`.

## Context

A vendor authors a Product Model Release by pasting ~300–400 lines of
deeply-nested JSON into a textarea on `/platform` (`release-form.tsx`, ADR
0060/0061) and discovers errors only on submit — a server 422 with `defects[]`.
A real release (`sliding-gate@1`) has 11 parameters, an option set, 2
constraints, 14 ordered derived dimensions, 16 part rules with nested BOM +
geometry, ports, terrain, and a 3-step wizard, and **Expr DSL strings appear
everywhere** (defaults, relevance, deviation bounds, constraint logic, every
derived/quantity/geometry formula), each referencing keys declared elsewhere in
the same document. Raw-JSON authoring of that is error-prone and expert-only.

The directive (Martin, 2026-06-19): enterprise-grade, most value to the customer,
the best solution on the market — not the smallest build.

Two repo facts shape the decision:

- **`@repo/model` and `@repo/engine` run in the browser** (ADR 0051) — so
  `validateRelease` and `deriveInstanceDetailed` can run client-side, making the
  editor's correctness feedback byte-identical to the server publish gate and the
  production engine.
- **`validate.ts` already computed each Expr slot's in-scope key universe inline**
  (different per slot: a `defaultExpr` sees earlier params only; a `derived[i]`
  sees params + option attrs + strictly-earlier derived; a geometry formula under
  `repeat` also sees the loop var; a connection constraint sees `self.*`/`other.*`).
  An editor offering autocomplete must know exactly the same sets — and if it
  re-derives them independently, the two drift the moment `validate.ts` changes.

## Decision

- **A model-IDE, not a 400-field form.** The editor (route `/platform/releases/new`)
  is a three-region authoring surface — a model navigator with live per-node
  defect badges, dense rule-table workbenches, and an always-on defects/preview
  dock — the idiom enterprise CPQ modeling tools use. Delivered in 4
  independently-shippable phases; Phase 1 (structured editor + live validation,
  **zero backend change**) already retires the raw-JSON textarea.

- **One source of scope truth — `slotScopes()`, consumed by `validateRelease`.**
  The inline per-slot scope construction is extracted into a pure exported helper
  `slotScopes(release): Map<string /* where */, ExprScope>` (`ExprScope =
{ known: ReadonlySet<string>; openPrefixes: readonly string[] }`), keyed by the
  exact `where` strings the gate already emits (`parameters[<key>].defaultExpr`,
  `derived[<key>]`, `parts[<path>].bom.quantity`,
  `parts[<path>].geometry[<gk>].at[0]`, …). `validateRelease` is rewritten to
  **consume** that map for its reference checks, so the gate and the editor's
  autocomplete cannot disagree about what is in scope where. The construction is
  static (release shape only, never evaluated values), so the editor recomputes it
  live per keystroke. This is the keystone correctness lock — all three design
  judges flagged "extract but don't consume → silent drift" as the top risk; the
  refactor is behavior-preserving (the full existing `validate` + engine + fixtures
  suites stay green, goldens reproduce `129891.504`/`79039.86`) and is proven by
  `slot-scopes.test.ts` (per-slot scope assertions + the consumption tie + an
  anti-drift invariant: every `ref.unknown` defect's `where` is a `slotScopes`
  key) and corpus coverage in `@repo/fixtures`.

- **`tokenize` is exported from `expr.ts`** (additive) so the editor's `ExprField`
  highlights with the canonical grammar — one tokenizer, no third re-implementation.

- **Publish stays the existing immutable path.** The editor serializes to the same
  body and calls the existing `POST /v1/releases` (the server re-runs
  `validateRelease` authoritatively); there is **no second freeze path**, so I3
  byte-reproducibility is untouched. Drafts (a separate mutable, author-scoped
  store) and the live engine preview land in later phases.

## Consequences

- `@repo/model` gains three exports — `slotScopes`, `ExprScope`, `tokenize` (+ the
  `Token` type) — on the single barrel; no exports-map or ESLint allow-list change.
  They are consumed by the editor in later Phase-1 sub-phases (mid-phase, `knip`
  sees them as unused until then).
- A duplicate key/path collapses to one scope in the `Map`; duplicates are
  themselves a hard defect `validateRelease` still surfaces, and no behavior the
  test suite exercises changes (defect order + contents preserved).
- The where↔fieldId mapping (the gate addresses by key/path, RHF by array index)
  becomes an explicit, tested layer in the web app so a defect never lands on the
  wrong field.
- **Phasing / deferred:** Phase 2 (SHIPPED 2026-06-21, see below) — parts/geometry
  master-detail + catalog-aware pickers + `GET /v1/platform/catalog-versions/:id`
  (PlatformGuard); Phase 3 (SHIPPED 2026-06-22, see below) — `release-drafts`
  module + autosave + clone-and-bump + diff; Phase 4 — web-worker
  validate+derive + live engine preview (wizard + BOM/price + per-formula `=value`)
  - power features.

### Phase 1 as shipped (2026-06-19)

- `packages/model`: `slotScopes` + `validateRelease` consuming it; `tokenize` +
  `EXPR_FUNCTIONS` (the autocomplete whitelist, one source) exported. Behavior-
  preserving (full suites + integration 16/90 green; goldens reproduce).
- `@repo/ui` (domain-agnostic, no `@repo/model` dep): `FieldShell`, `EnumSelect`,
  `DisclosureSection`, `ArrayField` (the repo's first `useFieldArray`), `NavTree`,
  `DefectList`.
- `apps/web/app/platform/releases/`: the editor, the per-slot `ExprField`
  (live parse + in-scope autocomplete + ref/fn check) and its pure helpers, the
  `where`↔fieldId bijection, the `useReleaseValidation` hook, the structured
  workbenches (identity, parameters, constraints, derived), and the **hybrid
  raw-JSON islands** (option sets, parts/BOM/geometry, ports, terrain, ui) that
  let Phase 1 author a COMPLETE release today. **`ExprField` lives in app-land,
  not `@repo/ui`** — it is `@repo/model`-coupled, and the generic kit stays
  domain-free. The editor uses one RHF form (per-section split is a later perf
  step); the `ExprField` syntax-highlight overlay is deferred to Phase 4
  (`tokenize` is exported and ready). No schema change.

Governing code: as listed above. No schema change in Phase 1.

### Phase 2 as shipped (2026-06-21)

Parts/geometry — the largest raw-JSON island (16 part rules with nested BOM +
geometry on the gate) — became a structured master-detail workbench, and the
catalog stopped being a number the operator types blind.

- **`apps/api` (2A):** `GET /v1/platform/catalog-versions` (list) + `GET
/v1/platform/catalog-versions/:id` (detail) on `PlatformController`
  (`PlatformGuard`, no org gate — mirrors the ADR 0067 global release read).
  Catalog versions are global + immutable, so both reuse the existing
  `CatalogVersionsService` reads; the platform tier exists so an org-less operator
  (who 403s on the `RolesGuard`-gated tenant routes) can load options while
  authoring. `PlatformModule` imports `CatalogVersionsModule` — the cross-module
  read goes through the owning service, never a schema join (ADR 0032). **No schema
  change.** `platform-catalog-read.itest` (4 cases): the detail body
  (materials/sections/components), the list, 404/400 on a bad id, and platform-only
  (tenant 403, anon 401).
- **`apps/web` (2B–2D):** the `partsJson` textarea island is RETIRED for a
  `PartsWorkbench` — an `ArrayField` of collapsible part cards (a new empty-path
  part opens by default; existing ones collapse into a master list), each carrying
  structured identity/resolve/bom fields and a NESTED `ArrayField` of geometry
  pieces (`length` / `at[3]` / `rotation[3]` / `cuts` / `repeat` — every Expr slot
  an `ExprField`, the loop `repeat.var` flowing into autocomplete scope because
  `slotScopes` already models it). The `where`↔fieldId bijection gains the
  parts/geometry builders (keyed by part `path` + geometry `key`), pinned to
  `slotScopes` over the corpus by `where.test` (both directions, ports excluded as
  a still-island). Built with the SAME Phase-1 `@repo/ui` primitives — **no new
  generic component** (the kit stays domain-agnostic; only the app-land
  `ExprField` grew a `codeSuggestions` prop).
- **Catalog-aware pickers (the keystone extension):** `resolve.role` (a plain
  catalog role) is a `<datalist>`-backed input of the catalog's component roles;
  `resolve.section`/`material` stay `ExprField` (ONE zero-drift Expr authoring path
  — they can be parameter-conditional, not just literals) but gain the catalog's
  section/material CODES as quoted string-literal completions (`codeCandidates` →
  `"jakl_30x30"`), quote-adjacency-aware so a completion accepted inside an open
  quote never doubles it. The identity workbench's catalog field becomes a
  published-version SELECT (sourced from the new list endpoint). **Most importantly,
  the editor now passes the LOADED catalog to `validateRelease(release, catalog)`**
  — so `catalog.role.unknown` / `catalog.section.unknown` / `catalog.material.unknown`
  defects appear live, byte-identical to the server publish gate (which already
  validates against the same catalog). Degrades to catalog-less validation when
  nothing is published yet (the server stays the authority).
- Publish still goes through the existing immutable `POST /v1/releases` — I3
  untouched, no second freeze path. Full gate + integration green; goldens
  reproduce `129891.504` / `79039.86`. **Phase 4** (web-worker validate+derive +
  live engine preview + the `ExprField` syntax-highlight overlay) remains its own
  gated slice.

### Phase 3 as shipped (2026-06-22)

The **draft + iterate** loop, so a vendor authors safely without publishing —
4 gate-green sub-slices (commits `bde1dc8`→`99b0304`). Publish stays the
existing immutable `POST /v1/releases` (no second freeze path, I3 untouched);
clone and the freeze itself are client-side, so the new module is a pure CRUD
store with no engine/release coupling.

- **3A — `release-drafts` module (`bde1dc8`).** A new MUTABLE `release_draft`
  table, **org-scoped** (ADR 0055: `organizationId` NOT NULL is the access
  scope, so a vendor TEAM shares its drafts; `ownerId` is the creator/audit ref;
  CASCADE on both — mutable working state, unlike the RESTRICT I3 stores). `body`
  jsonb holds the editor form state OPAQUE (drafts are legitimately incomplete —
  only the publish gate validates the shape); `modelId`/`version`/`catalogVersion`/
  `baseReleaseId` are denorm projections for the list + clone/diff.
  `/v1/platform/release-drafts` CRUD — **vendor-only** (`SessionGuard` +
  `PlatformGuard`, the releases-publish precedent: authoring is orthogonal to org
  membership, §3), org-scoped via `@CurrentScope()`. Autosave PATCH writes neither
  an audit row nor a transaction (high-frequency working state); create/delete
  bracket the lifecycle and are audited. Summary/detail split (list never ships
  the heavy body). Privacy handler (GDPR export/erase by author). Scaffolded via
  `pnpm gen module` then adapted — the generator template is **stale post-ADR-0055**
  (owner-scoped + dormant nullable org) and was flipped to the live org-scoped
  pattern; the outbox producer was removed (realtime=false left no consumer);
  status/archive dropped. NO outbox/realtime (drafts emit no domain events).
- **3B — autosave + resume (`ace5ede`).** `useDraftAutosave` — a debounced
  `form.watch` subscription (mirrors `useReleaseValidation`). A fresh editor holds
  no draft until the first edit; the first autosave CREATEs the row, then swaps
  the URL to `/platform/releases/drafts/[id]` via `history.replaceState` (no
  remount) so a reload resumes — subsequent edits PATCH. Saves are serialized
  (one in flight) + coalesced; unmount cancels the pending timer. A quiet header
  save-status badge; on publish, the draft is discarded (best-effort). Routes:
  `/platform/releases/drafts` (resume list) + `/drafts/[id]` (server-loads the
  draft, 404→notFound). The draft client slice is app-local in `platform-queries`
  (the platform surface is real-api-only; `api-mocks` unaffected).
- **3C — clone-and-bump (`baa17ee`).** `draftFromRelease(release, version,
catalogVersion)` — the faithful inverse of `buildReleaseFromDraft` over the
  editor-modeled surface (every `ExprString` is a branded string, so source
  recovery is `String(e)`; islands round-trip as pretty JSON). A "Clone" action
  on every console release row seeds a draft at version+1 (carrying
  `baseReleaseId` as provenance) and opens the editor; the vendor edits and
  publishes a NEW `modelId@version` through the immutable path. Proven by a
  round-trip test (`buildReleaseFromDraft(parse(draftFromRelease(r))) ≈ r`).
- **3D — clone diff (`99b0304`).** `GET /v1/platform/releases/by-release-id/:releaseId`
  (PlatformController, natural-key global read reusing `loadByReleaseId`, the I3
  path; literal `by-release-id` segment so no collision with the surrogate `:id`
  route; no schema change). `diffRelease(base, current)` — a structural diff of
  two BUILT releases keyed by business key (params/constraints/derived by key,
  parts by path), islands compared whole, the version bump reported separately;
  an order-insensitive `deepEqual`. `useReleaseValidation` now also returns the
  built release (no second build). For a cloned draft the editor lazy-loads the
  source and renders a "Changes vs {releaseId}" dock panel.

Full gate + integration green throughout (final: web 76/76, api unit 141,
integration 19 files/104); goldens `129891.504` / `79039.86` reproduce. Side
fix: the OpenAPI snapshot, stale since Phase 2A (`8556737` added the platform
catalog-versions routes but never regenerated it), is now correct. **Phase 4**
remains the only deferred slice.
