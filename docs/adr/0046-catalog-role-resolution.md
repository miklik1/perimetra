# ADR 0046 — Catalog as a versioned engine argument; role-based resolution is the ONE component mechanism

**Status:** Accepted (2026-06-12). Implemented in step 2 (CORE_SPEC §10).

## Context

Slice 1 named components directly: `PartRule.componentCode` plus an escape
hatch (`componentCodeExpr`) for the option-driven fill. CORE_SPEC §2 specifies
the real mechanism — derivation recipes request `{role, section, material}`
and the catalog resolves a Component — and §10 step 2 must prove
multi-material on the same authored model. Keeping the slice-1 bridge alive
alongside resolution would mean two component mechanisms forever; every later
layer (overrides, ledger, renderers) would have to handle both.

CORE_SPEC §9 also _suggests_ a separate `packages/catalog`. The catalog types
are ~80 lines of pure shapes and the resolution function ~40 lines of pure
lookup; a package boundary would add exports-map/eslint-DAG ceremony for no
isolation gain at this size.

## Decision

1. **`componentCode` / `componentCodeExpr` are deleted, not deprecated.** A
   `PartRule` carries exactly one way to name physical reality:
   `resolve: {role, section?: Expr, material?: Expr}`. Section/material are
   expressions so a parameter (`frame_material`) switches the whole gate
   between aluminum and steel against one recipe.
2. **Catalog types live in `@repo/model`** (`catalog.ts`), resolution in
   `@repo/engine` (`resolve.ts`). The §9 package cut is deferred until the
   catalog grows behavior of its own (tenant catalog overlays, step 3+); the
   types are part of the published contract either way.
3. **The catalog enters `deriveInstance` as a versioned data argument**
   (`catalog@N`), exactly like the price table — never ambient state — and
   the result carries `stamps: {releaseId, catalogVersion}` (I3: a quote
   re-derives forever from its stamps).
4. **Matching is exact per constrained axis, and an unconstrained axis must be
   absent on the component too.** A material-specific component never
   satisfies a material-agnostic request — that would be a silent guess (I5).
   Zero matches → a typed Issue carrying the missing triple (the vendor's
   "what to add to the catalog" worklist, CORE_SPEC §2). More than one match →
   an author-time throw (ambiguous catalog data).
5. **Price truth:** the ENZO rail threshold ternary (MVP U28, hardcoded CZK in
   the release) is replaced by two real SKUs (`rail_set_enzo`,
   `rail_set_enzo_long`); the recipe's `when` picks WHICH set, the price table
   says what each costs. Release data holds no prices (the price-bypass class
   is closed).

## Consequences

- Adding a material to a family = adding catalog components + prices; the
  release is untouched (the §11 metric (b) this step exists to prove —
  `steel_frame_3panel` derives delta-0 against the same recipe).
- `validateRelease(release, catalog)` can statically check role existence and
  literal section/material codes; parameter-driven requests resolve (or
  I5-fail) at derive time.
- A release is no longer self-contained: derivation requires a catalog whose
  roles cover the release's requests. The fixtures pin `catalog@1`; the
  publish flow (step 3+) must record the minimum catalog version a release
  was fixtured against.
