# ADR 0068 — Structured release editor + slotScopes() single source of scope truth

**Status:** Accepted (2026-06-19). **Phase 1 shipped 2026-06-19.** Implements the
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
- **Phasing / deferred:** Phase 2 — parts/geometry master-detail + catalog-aware
  pickers + `GET /v1/platform/catalog-versions/:id` (PlatformGuard); Phase 3 —
  `release-drafts` module + autosave + clone-and-bump + diff; Phase 4 — web-worker
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
