# Structured Release Editor — Design

**Date:** 2026-06-19
**Status:** Awaiting review (design approved in dialogue; foundations verified read-only against the codebase)
**Base:** Perimetra enterprise rebuild, `main` at `53d1793`. Replaces the raw-JSON release publish form on the vendor `/platform` console (ADR 0060/0061; `apps/web/app/platform/release-form.tsx`). The §3 release lifecycle (publish → assign → lazy-pin → opt-in → broadcast → retire, ADR 0062–0067) ships; this is the last named step-6 vendor/admin authoring surface.

## 1. Purpose & guiding principles

Today a vendor authors a Product Model Release by pasting ~300–400 lines of deeply-nested JSON into a textarea and discovering errors only on submit (a server 422 with `defects[]`). A real release (`sliding-gate@1`) has 11 parameters, an option set, 2 constraints, 14 ordered derived dimensions, 16 part rules with nested BOM + geometry, 2 ports, terrain, and a 3-step wizard — and **Expr DSL strings appear everywhere** (defaults, relevance, deviation bounds, constraint logic, every derived/quantity/geometry formula), each referencing keys defined elsewhere in the same document. Raw-JSON authoring of that is error-prone and expert-only.

This design replaces it with a **best-on-market, enterprise-grade structured editor**. The bar (Martin, 2026-06-19): _enterprise-grade, most value to the customer, the best solution on the market should guide the decision_ — not the smallest build.

Three principles drive the design:

1. **A model-IDE, not a 400-field form.** A release is a _program_ the generic engine interprets, so its author is a programmer-of-products and the editor is an IDE for the release: a model navigator, dense rule-table workbenches, and an always-on correctness surface — the idiom enterprise CPQ modeling tools (Tacton, Configit) use.

2. **Zero drift — what you see green publishes green.** `@repo/model` (`validateRelease`, `parse`, `collectRefs`/`collectCalls`, `isKnownFunction`) and `@repo/engine` (`deriveInstanceDetailed`) already run in the browser (ADR 0051). The editor's correctness feedback is therefore _byte-identical to the server publish gate and the production engine_, and the BOM/price it previews is the price that bills. Cloud-roundtrip CPQ tools cannot promise this; it is the design's unfair advantage. The discipline that makes it true: **one source of scope truth** (§3).

3. **The wrong thing is caught at the field, before publish.** Every Expr slot validates live — parse, in-scope autocomplete, reference-checking — and every defect maps back to the field that produced it. The immutable publish becomes a formality over an already-proven model, not a guessing game.

### Success criteria

- A vendor authors parameters / constraints / derivation **visually**, with autocompleting, live-validated, syntax-highlighted expressions and per-field defects; the raw-JSON textarea is gone.
- Client-side validation is provably identical to the server publish gate (one `slotScopes()` truth; a golden test enforces it over the corpus).
- Publishing still goes through the **existing immutable `POST /v1/releases`** — no new freeze path, I3 byte-reproducibility untouched.
- The full quality bar stays green: `pnpm check-types && lint && test && build && knip` (+ `test:integration` when backend behavior changes); goldens reproduce (price `129891.504`, cost `79039.86`).
- Each phase is independently shippable; Phase 1 beats raw-JSON on day one with zero schema changes.

## 2. Architecture — the model-IDE

Route `/platform/releases/new` (and `/platform/releases/[draftId]` once drafts land in Phase 3). The current `ReleaseForm` textarea mount on `/platform` becomes a "New release" CTA (+ a draft list in Phase 3). Three regions:

- **Left — model navigator (`NavTree`).** A tree mirroring the release shape: Identity & catalog · Parameters[N] · Option sets[N] · Constraints[N] · Derivation › Derived[N] / Parts[N] · Ports[N] · Terrain · Wizard. Each node badges its **live defect count** (red error / amber warn) so a 400-line model stays navigable and the author jumps straight to the broken slot. A typed `SectionDescriptor` registry drives both the tree and which workbench renders — a future schema section is one registry entry.
- **Center — active workbench**, one section at a time (never the whole document). Collections render as **dense editable rule-tables** (the CPQ idiom): Parameters = `key | type | domain | adjustability | default/expr | deviation | relevance`; a row expands inline for nested editing. Parts (Phase 2) render as **master-detail**: parts table left, the selected part's `resolve` / `bom` / `geometry[]` editor right.
- **Right — dock.** Two tabs: **Defects** (grouped `validateRelease` output, click-to-navigate) and **Preview** (live wizard + BOM/price; Phase 4). The always-on governance surface.

Top bar: draft status + autosave indicator (Phase 3), total error/warn count, and a **Publish** button disabled while any error-severity defect exists (warnings allowed).

## 3. The keystone — zero-drift Expr authoring via `slotScopes()`

Authoring + validating Expr strings is the make-or-break of the whole editor, because each Expr field has a _different_ set of legal references (a `defaultExpr` sees only earlier params + `price.*`; a `derived[i]` sees params + option attrs + strictly-earlier derived; a `geometry` formula under `repeat` also sees the loop var; a connection constraint sees `self.*`/`other.*`).

`validate.ts` already computes exactly these per-slot scopes — **inline**, and (verified) **statically**, depending only on the release's shape, never on runtime-evaluated values. The mandatory refactor (the single correctness lock):

```ts
// packages/model/src/validate.ts → exported, added to the single barrel index.ts
export interface ExprScope {
  known: ReadonlySet<string>;
  openPrefixes: readonly string[];
}
export function slotScopes(release: ProductModelRelease): Map<string /* where */, ExprScope>;
```

keyed by the **exact `where` strings** `validateRelease` already emits. Then `validateRelease` is rewritten to **consume `slotScopes()`** for its scope lookups — so there is one source of scope truth and the editor's autocomplete can never drift from the validator after a `validate.ts` change. `tokenize` is also exported from `expr.ts` (additive) for the highlight overlay. Both go in the single barrel; the `exports` map has only `"."`, so no exports-map or ESLint allow-list change is needed.

**`ExprField`** (the keystone `@repo/ui` primitive) takes `{ value, onChange, scope: ExprScope, defect? }` and, using only already-exported `@repo/model` primitives running in-browser:

1. **Syntax highlight** — a controlled `<textarea>` with an absolutely-positioned token overlay (via exported `tokenize`: refs blue, functions purple, numbers/operators neutral). No CodeMirror/Monaco: the DSL is single-line, the tokenizer exists, and the kit rule wants a distinctive look + small bundle.
2. **Live parse** (debounced ~120ms) — `parse(value)`; on `ExprError`, the exact `expr.ts` message inline ("Unterminated string", "Expected )"); green tick on success.
3. **In-scope autocomplete** — a keyboard-navigable popover (radix Popover) offering `scope.known` (with type/label detail from the param def), the whitelisted functions (`isKnownFunction` — min/max/abs/floor/ceil/round/roundUp/roundTo/clamp/sinDeg/if) with arg hints, and the `price.`/`self.`/`other.` open prefixes. Because scope is computed live from the draft, adding a parameter immediately makes it completable downstream.
4. **Ref/fn check** — on clean parse, `collectRefs(ast)` − `known` − `openPrefixes` → amber "will not be in scope here"; `collectCalls(ast)` − `isKnownFunction` → "not a whitelisted function". Field-local, instant, before the full pass.
5. **Inline evaluated-value readout** (Phase 4) — `= 1840` beside the formula via `evaluate(ast, sampleScope)`, fed by the `scope` that `deriveInstanceDetailed` returns. **Jump-to-definition** (Phase 4): Cmd-click a known ref navigates to its defining node.

### The `where`↔`fieldId` bijection

`validate.ts` addresses defects by **key/path** (`derived[<key>]`, `parts[<path>].bom.quantity`, `parts[<path>].geometry[<gk>].at[0]`, `constraints[<key>]`, `ports[<id>].anchor.at[0]`, `parameters[<key>].defaultExpr`, …), never by array index. RHF `useFieldArray` tracks rows by a numeric/opaque field id. A mismatch silently drops a defect onto no field. The mitigation is an explicit, exhaustively-tested mapping layer `apps/web/app/platform/releases/lib/where.ts` (`whereParamDefaultExpr(key)`, `whereDerived(key)`, …); fields read their defect by their **business key**, not the array index. A bijection test over a corpus release covering every section runs before Phase 1 ships.

## 4. Phased roadmap

Each phase is independently shippable.

| Phase                                        | Delivers                                                                                                                                                                                                                                                                                                                                                                  | Backend                                                     |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| **1 — Structured editor + live validation**  | Full-page editor replacing the textarea: `NavTree` + rule-table workbenches for Identity, Parameters, Option sets, Constraints, Derived; the **`ExprField` keystone**; live `validateRelease`; per-field defects + section badges + `DefectList`. Publishes via the existing immutable `POST /v1/releases` (client-state only). The 7 missing `@repo/ui` form primitives. | **None** (one `@repo/model` refactor)                       |
| **2 — Parts + geometry + catalog-aware**     | Parts master-detail; nested `resolve`/`bom`/`geometry[]` editors; nested `useFieldArray` for geometry with `repeat.var` scope injection; literal-or-expr toggles; `CatalogPicker` dual-mode control; live `catalog.*` defects; ports + terrain editors.                                                                                                                   | new `GET /v1/platform/catalog-versions/:id` (PlatformGuard) |
| **3 — Drafts + autosave + clone-and-bump**   | `release-drafts` module; editor loads/saves drafts, autosaves; draft list; duplicate-published-release-to-new-draft (`?from=`, version+1); structured client-side diff-vs-released; draft id as the Publish Idempotency-Key.                                                                                                                                              | new `release-drafts` module + table                         |
| **4 — Live engine preview + power features** | `validateRelease` + `deriveSite` in a shared web worker (last-write-wins token); Dock Preview tab (in-browser `resolveUi` wizard + `deriveInstanceDetailed` BOM/price/Issues on sample input; per-part preview-pieces); `ExprField` inline `=value`; jump-to-definition; URL deep-link to a defect node; command palette; live UiSpec step/group builder.                 | none                                                        |

## 5. Phase 1 — detailed design (spec-ready)

### 5.1 Goal & boundary

Replace the raw-JSON textarea with a structured, live-validated editor for the flat-ish sections (Identity, Parameters, Option sets, Constraints, Derived). **No backend change, no draft store** — client-state only, serializing to the same body and POSTing the existing immutable `POST /v1/releases`. Parts/geometry/catalog/preview are Phases 2–4. This slice alone decisively beats raw-JSON.

### 5.2 The model refactor (do this first — the correctness foundation)

Extract `slotScopes()` and rewrite `validateRelease` to consume it (§3); export `tokenize`. Tests:

- `validate.test.ts` stays green (the refactor is behavior-preserving).
- **New golden test:** over the corpus releases, every defect `where` from `validateRelease` is a key in `slotScopes()`, and each `slotScopes()` entry's `known`/`openPrefixes` equals what the old inline code produced (snapshot). This is the lock the design depends on — all three design judges flagged "extract but don't consume → silent drift" as the #1 risk.

### 5.3 The `where`↔`fieldId` bijection layer

`apps/web/app/platform/releases/lib/where.ts` — pure functions mapping a rendered field's identity to a `validate.ts` `where` string. Exhaustive bijection test over a corpus release covering all Phase-1 sections (§3).

### 5.4 New `@repo/ui` primitives

(radix-backed where applicable; the unified `radix-ui` package `^1.4.3` is already a dependency — primitives are reached via `import { Accordion, Popover, Collapsible } from "radix-ui"`, **not** new `@radix-ui/react-*` packages.)

- **`FieldShell`** (`forms/field-shell.tsx`) — label + description + `cs` help slot + error/warn slot + adjustability/severity affordance. The repo's first field wrapper; wraps every leaf; reads its defect by `where`.
- **`ArrayField`** (`forms/array-field.tsx`) — typed `useFieldArray` wrapper (the **first** `useFieldArray` usage in the repo): add/remove/drag-reorder, render-prop row body, per-row defect badge, `React.memo` rows keyed by stable field id (explicit memoization for 400-line scale).
- **`DataGrid` / `EditableTable`** (`forms/data-grid.tsx`) — dense inline-editable rule-table; row expands inline (radix Collapsible) for nested editing.
- **`EnumSelect`** (`forms/enum-select.tsx`) — typed dropdown bound to a string-literal union (`ParamType`, `Adjustability`, `DeviationMode`, `ConstraintDef.kind`/`severity`/`scope`).
- **`Accordion` / `DisclosureSection`** (`forms/accordion.tsx`) — radix Accordion wrapper for nested sections (deviation, domain).
- **`NavTree`** (`components/nav-tree.tsx`) — left-rail tree with live per-node defect-count badges + selection.
- **`DefectList`** (`components/defect-list.tsx`) — grouped, severity-coded, click-to-navigate panel (generalizes the inline 422 rendering in `release-form.tsx`).
- **`ExprField`** (`forms/expr-field.tsx`) — the keystone (§3), capabilities 1–4 in Phase 1; single-line variant only (every Phase-1 Expr slot is single-line).

ESLint: new primitives sit under the existing `./forms/*` / `./components/*` `exports` patterns, already on the `no-restricted-imports` allow-list — no allow-list edit expected; confirmed by the `pnpm lint` gate.

### 5.5 Data flow

The draft is a `ProductModelRelease`-shaped object. **Per-section RHF** via `useZodForm` (the only RHF entry, ESLint-enforced) with a per-section zod schema mirroring `schema.ts` **structurally only** — deep Expr semantics live in `validateRelease`, never duplicated in zod. RHF is initialized via `defaultValues` (never `reset()` in `useEffect` — ESLint rule). Per-section RHF (not one giant form) so a param edit doesn't re-render the whole document.

On any change, a top-level `useReleaseValidation(draft)` hook (main thread, wrapped in `startTransition`, debounced 250ms) runs `validateRelease(draft)` (no catalog yet → `catalog.*` checks deferred to Phase 2) and produces `Map<where, ReleaseDefect[]>`. Each `FieldShell`/`ExprField`/row reads its defect by `where`; `NavTree` + section headers roll up counts. `ExprField` additionally runs its own synchronous per-keystroke (~120ms) local parse/ref-check against its `scope` from `slotScopes(draft)` (recomputed memoized on draft change).

### 5.6 Validation / preview wiring

Phase 1 is validation only (preview is Phase 4). The Publish button reads the global error-severity count: 0 errors → enabled (warns allowed). On Publish: a final client `validateRelease` (belt), then `mutation.mutate({ input: { catalogVersion, body: draft, initialInput }, idempotencyKey: crypto.randomUUID() })` against the existing `adminQueries.publishRelease()` — the exact contract `release-form.tsx` uses today.

### 5.7 Error handling

- Client: inline per-field defects + the `DefectList`; Publish disabled on errors; an explicit "unsaved changes" `beforeunload` warning (no draft store yet).
- Server `422 release_invalid`: defects are re-mapped through the same `where`→field bijection and re-displayed inline (not just the flat list shown today) — proving zero client/server drift to the author.
- `409` duplicate natural key: toast "version already published — bump the version".

### 5.8 i18n

All chrome labels via `@repo/i18n/web` `useTranslations`; keys added to `cs.ts` (source) + mirrored in `en.ts` (tsc parity test). Defect `message` strings from `validateRelease` are English, vendor-facing — shown verbatim (the audience is expert operators); surrounding chrome is `cs` (default locale).

### 5.9 Testing

- Model: the `slotScopes()` golden test + behavior-preserving `validate.test.ts`.
- Web: the `where`↔`fieldId` bijection test over a corpus release.
- `ExprField` units: parse-error surfacing, autocomplete candidate set for a given scope, ref/fn-check squiggle for an out-of-scope ref.
- Component: editing a param key updates downstream `ExprField` autocomplete (dependency-aware scope recompute).
- DoD gate green.

## 6. Backend changes (across phases)

- **`@repo/model` refactor (Phase 1):** extract `slotScopes()` and make `validateRelease` consume it; export `tokenize`. Single barrel; no exports-map/eslint change. Golden scope-equality test.
- **No change to the immutable publish path (all phases):** `POST /v1/catalog-versions`, `POST /v1/releases`, `POST /v1/price-tables` stay immutable (no PATCH/PUT). The editor's Publish calls the **existing** `POST /v1/releases` directly; the server re-runs `validateRelease` authoritatively. No second I3 freeze path.
- **`GET /v1/platform/catalog-versions/:id` (Phase 2):** new, **PlatformGuard-gated**, returning the full Catalog body — mirroring ADR 0067's `GET /v1/platform/releases/:id`. Needed because the existing `GET /v1/catalog-versions/:id` is `RolesGuard`/org-gated and 403s an org-less platform operator (verified). The editor needs the Catalog client-side for catalog-aware pickers and as `validateRelease`'s second argument.
- **`release-drafts` module (Phase 3, `pnpm gen module`):** table `release_draft { id uuidv7, modelId, version int, catalogVersion int, body jsonb (partial release), initialInput jsonb?, baseReleaseId text?, authorUserId, updatedAt, label? }` — **mutable, explicitly outside the I3 reproducibility set**, scoped to **`authorUserId` / platform actor, NOT `organizationId`** (release authoring is vendor-only and orthogonal to org membership per ADR 0062 — the org-scoped repository pattern from projects/quotes is wrong here). Endpoints: `POST /` (create; `?from=<releaseId>` clones a published body + bumps version), `GET /` (keyset list), `GET /:id`, **`PUT /:id`** (full-document replace — matches the `projects/:id/site` PUT precedent, ADR 0054; not PATCH; optimistic concurrency on `updatedAt`), `DELETE /:id`. All PlatformGuard-gated. Publish uses the draft id as Idempotency-Key.
- **`@repo/validators` (Phase 3):** release-draft zod contracts (request + response — every endpoint returns through a zod response schema, ADR 0039); `body` crosses as `z.unknown()` like the existing publish contract (deep semantics stay in `validateRelease`).

## 7. Decisions (settled in dialogue, 2026-06-19)

1. **Web worker — deferred to Phase 4.** Phase 1 has no `deriveSite`; main-thread `validateRelease` + `startTransition` is comfortable for a few-hundred-expr release, and it avoids the Next App Router module-worker bundler-wiring risk in slice 1. The worker lands when `deriveSite` runs continuously (Phase 4).
2. **Draft concurrency — last-write-wins on `updatedAt`.** The surface is single-author-per-draft in practice (Perimetra staff); matches the `projects/:id/site` precedent. A soft lock is premature.
3. **On publish — archive the draft** (status=published, kept for diff history), not delete. Enables the clone-and-bump diff-vs-released story and an audit trail at trivial cost; a manual delete handles genuine throwaways.

## 8. Key risks & mitigations

- **`slotScopes()` must be consumed by `validateRelease`, not merely extracted** — otherwise two scope derivations drift and the editor's autocomplete silently lies. Hard constraint + the golden scope-equality test over the corpus. (#1 risk, flagged by all three design judges.)
- **`where`↔`fieldId` bijection** — validator addresses by key/path, RHF by index; a mismatch silently drops defects. Explicit, exhaustively-tested mapping layer before Phase 1 ships (§3, §5.3).
- **`ExprField` scope-creep** — a usable token-overlay editor (highlight + popover + keyboard nav + a11y + cursor/selection sync in a controlled textarea) is real UI work. Keep it strictly single-line-expression-scoped; it is the slice that can sink Phase 1 if mis-budgeted.
- **First `useFieldArray` + deep nesting** (`parts → geometry → at[3]`) risks RHF re-render storms at 400-line scale. Mitigate with `React.memo` rows keyed by stable field id and per-section RHF.
- **Catalog read auth gap** — the editor must fetch the Catalog client-side; the existing route is org-gated and 403s an org-less operator. Phase 2 adds the PlatformGuard route (verified gap), does not reuse the org-gated one.
- **Draft store must stay strictly separate from the immutable I3 release store** — mutable, `authorUserId`-scoped (not org), and Publish goes through the existing `POST /v1/releases` only (no parallel freeze path), or it threatens byte-reproducibility.

## 9. Foundations verified (read-only, 2026-06-19)

All seven load-bearing claims confirmed against the codebase before approval:

1. `validate.ts` builds per-slot scopes **inline and statically** → `slotScopes()` extracts cleanly, no obstacle.
2. All 25+ defect `where` strings are **key/path-addressed**, never array-index → bijection viable.
3. `tokenize` exists (internal, trivially exportable); `parse`/`evaluate`/`collectRefs`/`collectCalls`/`isKnownFunction`/`ExprError` already exported.
4. `@repo/model` is a true single barrel (`exports` has only `"."`) → adding exports needs zero config/ESLint change.
5. `deriveInstanceDetailed` returns `{ result, scope }` with the flat evaluated scope → powers the `=value` readout + preview.
6. The unified `radix-ui` (`^1.4.3`) **and** `react-hook-form` are already deps; **zero** existing `useFieldArray` usage (this is the first). Accordion/Popover/Collapsible are sub-imports of the present `radix-ui` package — no new dependency.
7. The catalog auth gap is real; `GET /v1/platform/releases/:id` (ADR 0067) is the pattern to mirror for the new platform catalog read.

## 10. Out of scope

- The structured price-table form already exists (`/admin`, ADR 0061) and is unchanged.
- Catalog _authoring_ (the catalog publish form) stays raw-JSON for now — a separate future slice; this design only _reads_ a published catalog (Phase 2).
- `adjustability: tenant` UX, issue-key i18n, deviation-override UX, `/site`↔`/configurator` convergence remain separate step-6/step-7 follow-ups.
