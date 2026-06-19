# Structured Release Editor — Phase 1 implementation plan

Executes Phase 1 of the approved spec
(`docs/superpowers/specs/2026-06-19-structured-release-editor-design.md`):
the structured editor + live validation, **zero backend change** (one
`@repo/model` refactor). Sub-phases are ordered so foundations land before
anything that depends on them; each ends with the full quality bar green
(`pnpm check-types && lint && test && build && knip`, `--force` the turbo gate
— cache-replay masks failures, ADR 0052) and a commit. The corpus goldens must
still reproduce (price `129891.504`, cost `79039.86`). Dev-mode: commit + push
straight to `main`, no branch/PR; no `Co-Authored-By` trailer.

**Definition of done for the phase:** a vendor opens `/platform/releases/new`,
authors parameters / option sets / constraints / derived dimensions in
structured workbenches with autocompleting, syntax-highlighted, live-validated
Expr fields and per-field defects, and publishes through the existing immutable
`POST /v1/releases`. The raw-JSON `ReleaseForm` textarea is gone. Client-side
validation is provably identical to the server gate (the `slotScopes()` golden
test).

---

## Sub-phase A — Model refactor (the correctness foundation; do first)

The single source of scope truth. Pure `@repo/model` work, no UI.

1. `packages/model/src/validate.ts`: extract the inline per-slot scope
   construction into a pure exported helper
   `slotScopes(release): Map<string /* where */, ExprScope>` where
   `ExprScope = { known: ReadonlySet<string>; openPrefixes: readonly string[] }`,
   keyed by the **exact `where` strings** `validateRelease` already emits
   (`parameters[<key>].defaultExpr`, `derived[<key>]`,
   `parts[<path>].bom.quantity`, `parts[<path>].geometry[<gk>].at[0]`,
   `constraints[<key>]`, `ports[<id>].anchor.at[0]`, …).
2. Rewrite `validateRelease`'s scope lookups to **consume `slotScopes()`** (it
   becomes a consumer of its own helper). The construction is static
   (release-shape only, no runtime-evaluated values — verified), so this is a
   behavior-preserving refactor.
3. `packages/model/src/expr.ts`: add `export` to the existing internal
   `tokenize` (additive) for the highlight overlay.
4. `packages/model/src/index.ts`: confirm the barrel re-exports `slotScopes`,
   `ExprScope`, and `tokenize` (single barrel; `exports` map has only `"."`, so
   no exports-map / ESLint allow-list change).
5. Tests (`packages/model/src/`):
   - `validate.test.ts` stays green unchanged (behavior preserved).
   - **New** `slot-scopes.test.ts`: over every corpus release, (a) every defect
     `where` produced by `validateRelease` is a key in `slotScopes()`, and
     (b) each entry's `known`/`openPrefixes` equals what the pre-refactor inline
     code produced (snapshot captured before the refactor). This is the lock the
     whole editor depends on.

**Exit:** `pnpm --filter @repo/model test` green; full gate green; `--filter api
test:integration` green as a belt (the seed publishes the corpus through
`validateRelease`); goldens reproduce. Commit. **ADR 0068** (confirm next free
number against `docs/adr/README.md`) — the structured release editor +
`slotScopes()` single-source-of-scope-truth + client-side validation decision.

---

## Sub-phase B — `@repo/ui` form primitives

The building blocks the repo lacks. Each is presentational + unit-tested; built
on the unified `radix-ui` package (`^1.4.3`, already a dep — import as
`import { Accordion, Popover, Collapsible } from "radix-ui"`, no new
`@radix-ui/react-*` deps). Order: simple → the keystone.

1. `forms/field-shell.tsx` — `FieldShell`: label + description + `cs` help slot +
   error/warn slot + `aria-invalid`/`aria-describedby` wiring (`useId` pair) +
   adjustability/severity affordance. Reads its defect by `where`. The repo's
   first field wrapper.
2. `forms/enum-select.tsx` — `EnumSelect`: typed dropdown over a string-literal
   union (`ParamType`, `Adjustability`, `DeviationMode`, `ConstraintDef.kind`/
   `severity`/`scope`).
3. `forms/accordion.tsx` — `Accordion` / `DisclosureSection`: radix Accordion
   wrapper for nested sections (deviation, domain).
4. `forms/array-field.tsx` — `ArrayField`: typed `useFieldArray` wrapper (the
   **first** `useFieldArray` in the repo): add / remove / drag-reorder,
   render-prop row body, per-row defect badge, `React.memo` rows keyed by stable
   field id (the explicit memoization for 400-line scale).
5. `forms/data-grid.tsx` — `DataGrid` / `EditableTable`: dense inline-editable
   rule-table; row expands inline (radix Collapsible) for nested editing.
6. `forms/expr-field.tsx` — **`ExprField`** (the keystone). Controlled
   `<textarea>` + absolutely-positioned token overlay (exported `tokenize`:
   refs blue, fns purple, numbers/ops neutral) + autocomplete popover (radix
   Popover, keyboard nav, Tab to accept). Props
   `{ value, onChange, scope: ExprScope, defect? }`. Capabilities: (1) highlight,
   (2) live parse (`parse`/`ExprError`, debounced ~120ms), (3) in-scope
   autocomplete from `scope.known` + `isKnownFunction` whitelist + open
   prefixes, (4) ref/fn check (`collectRefs`/`collectCalls`). Strictly
   single-line. **Risk-watch:** cursor/selection sync + a11y in the overlay is
   the part most likely to overrun — keep scope tight.
7. `components/nav-tree.tsx` — `NavTree`: left-rail tree with live per-node
   defect-count badges + selection.
8. `components/defect-list.tsx` — `DefectList`: grouped, severity-coded,
   click-to-navigate panel (generalizes the inline 422 rendering in
   `release-form.tsx`).
9. Exports: add each to `packages/ui/src/index.ts` and confirm the `@repo/ui`
   `package.json` `exports` map exposes `./forms/*` and `./components/*`
   (the `forms/use-zod-form` subpath proves `./forms/*` exists; extend if
   `./components/*` is missing). `pnpm lint` confirms the `no-restricted-imports`
   allow-list needs no edit.
10. Tests (Vitest + Testing Library): `ExprField` — parse-error surfacing,
    autocomplete candidate set for a given `scope`, ref/fn-check squiggle for an
    out-of-scope ref; `ArrayField` — add/remove/reorder + per-row defect badge.

**Exit:** `pnpm --filter @repo/ui test` + full gate green. Commit (may split
into 2–3 logical commits: simple primitives / ArrayField+DataGrid / ExprField).

---

## Sub-phase C — The `where`↔`fieldId` bijection layer

1. `apps/web/app/platform/releases/lib/where.ts` — pure functions mapping a
   rendered field's identity (business key + subpath) to a `validate.ts` `where`
   string: `whereParamDefaultExpr(key)`, `whereParamRelevance(key)`,
   `whereParamDeviation(key, "min"|"max")`, `whereConstraint(key)`,
   `whereDerived(key)`, `whereOptionSet(key)`, etc. Fields read their defect by
   **business key**, never the RHF array index.
2. **Exhaustive bijection test** over a corpus release covering every Phase-1
   section: every `slotScopes()` key for the Phase-1 sections is producible by a
   `where.ts` function and round-trips.

**Exit:** test green. (Folded into the Sub-phase D commit if small.)

---

## Sub-phase D — The editor surface

1. Routes: `apps/web/app/platform/releases/new/page.tsx` (RSC shell — mirrors
   the existing `/platform` pattern: `createServerApiClient` → prefetch
   `authQueries.me()` → `HydrationBoundary` → client). Client component
   `apps/web/app/platform/releases/release-editor.tsx` (`AuthGuard` +
   `isPlatformAdmin` gate, fail-closed).
2. Layout: the three-region model-IDE (NavTree left / workbench center / dock
   right) + top bar (error/warn count + Publish). A typed `SectionDescriptor`
   registry (`lib/sections.ts`) drives both the NavTree and which workbench
   renders.
3. Draft state + per-section RHF: the draft is a `ProductModelRelease`-shaped
   object; each section uses `useZodForm` (the only RHF entry) with a
   **structural-only** zod schema in
   `apps/web/app/platform/releases/lib/section-schemas.ts` (mirrors `schema.ts`
   shape; deep Expr semantics stay in `validateRelease`, never duplicated).
   Initialize via `defaultValues` — **never** `reset()` in `useEffect` (ESLint
   rule). Per-section forms (not one giant form) to bound re-renders.
4. `lib/use-release-validation.ts` — assembles the section drafts into a
   candidate `ProductModelRelease`, runs `validateRelease(draft)` (no catalog
   yet → `catalog.*` deferred to Phase 2), debounced 250ms in `startTransition`,
   produces `Map<where, ReleaseDefect[]>`. Memoized `slotScopes(draft)` handed
   to each `ExprField` by its `where`. NavTree + section headers roll up counts.
5. Workbenches (`apps/web/app/platform/releases/sections/`): Identity &
   catalog (modelId / version / catalogVersion / initialInput) · Parameters
   (DataGrid: `key | type | domain | adjustability | default/expr | deviation |
relevance`, with the literal-or-`defaultExpr` toggle enforcing the
   mutual-exclusion structurally) · Option sets · Constraints · Derived (ordered
   ArrayField; each row's ExprField scoped to strictly-earlier derived).
6. Publish: top-bar button disabled while any error-severity defect exists
   (warns allowed). On click: final client `validateRelease` (belt) →
   `adminQueries.publishRelease()` (`POST /v1/releases`,
   `idempotencyKey: crypto.randomUUID()`, the exact contract `release-form.tsx`
   uses). 422 `release_invalid` → re-map server defects through `where.ts` and
   show inline (proving zero drift). 409 → toast "version already published —
   bump the version". 201 → toast + navigate to `/platform`.
7. Error handling: inline per-field defects + `DefectList`; `beforeunload`
   unsaved-changes warning (no draft store yet).
8. i18n: a `releaseEditor` namespace in `packages/i18n/src/messages/cs.ts`
   (source) mirrored in `en.ts` (tsc parity). Defect `message` strings from
   `validateRelease` shown verbatim (English, vendor-facing — acceptable).

**Exit:** the editor authors + publishes a release end-to-end (manually
verified against the seeded corpus where the local stack allows; otherwise via
component/integration coverage — note the local DB-port collision with mercata
blocks a live headless run on this box). Full gate green. Commit.

---

## Sub-phase E — Cut over `/platform` + cleanup

1. `apps/web/app/platform/platform-client.tsx`: replace the `<ReleaseForm>`
   mount with a "New release" CTA → `/platform/releases/new`. Keep
   `CatalogForm` (catalog publish stays raw-JSON this phase) + the releases list
   - `AssignmentManager` unchanged.
2. Delete `apps/web/app/platform/release-form.tsx` once nothing imports it
   (knip will flag it otherwise). Salvage its 422 defect-rendering into
   `DefectList` (done in Sub-phase B).
3. Update `apps/web/app/platform/release-form.test.*` if present (retarget or
   remove).

**Exit:** `pnpm knip` clean (no dead `release-form`); full gate green.

---

## Sub-phase F — Phase close

1. Full DoD gate `--force`; `pnpm --filter api test:integration` (belt — the
   model refactor sits on the publish path); goldens reproduce (`129891.504` /
   `79039.86`).
2. ADR 0068 finalized (if not already in Sub-phase A); `docs/adr/README.md`
   index updated; CLAUDE.md narrative + the Perimetra hub `## Now` swept
   (overwrite, dated); the `release-editor` plan marked Phase-1-complete.
3. Vault: any reusable gotcha (first `useFieldArray`, the token-overlay
   ExprField pattern, the `slotScopes` single-source pattern) → `30 Resources/
Engineering/` + the findings index. Upstream-worthy primitives (FieldShell,
   ArrayField, ExprField, the radix wrappers) are skeleton-channel candidates —
   note for the next channel-A drain.
4. Commit + push to `main`. Overwrite the DONE-receipt at the top of the seat
   memory file.

---

## Risks carried from the spec (§8)

- `slotScopes()` MUST be consumed by `validateRelease`, not just extracted →
  Sub-phase A golden test is the gate.
- `where`↔`fieldId` mismatch silently drops defects → Sub-phase C exhaustive
  test before the editor ships.
- `ExprField` overlay (cursor/selection/a11y) is the most likely overrun →
  strictly single-line; budget it as the heaviest primitive.
- RHF re-render storms → `React.memo` rows + per-section forms.
- No live headless run on this box (mercata holds pg/redis ports) → lean on
  component + integration coverage; manual headless verification deferred to an
  environment with free ports.

## Not in this plan (later phases, own plans)

- Phase 2: parts/geometry master-detail + catalog-aware pickers +
  `GET /v1/platform/catalog-versions/:id` (PlatformGuard).
- Phase 3: `release-drafts` module + autosave + clone-and-bump + diff.
- Phase 4: web-worker validate+derive + live engine preview + power features.
