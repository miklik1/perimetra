# ADR 0047 — Error taxonomy: author-time throws, config-time typed Issues

**Status:** Accepted (2026-06-12). Implemented in step 2 (CORE_SPEC §10).

## Context

Slice 1 surfaced every failure the same way: a thrown `Error`/`ExprError`.
That conflates two audiences. A bad expression in a release is the **vendor's**
bug (nothing a tenant user did causes it, nothing they do fixes it); an
out-of-range width is the **user's** input (the UI must render it, localized,
next to the field). I7 (tenants cannot break models) was also enforced
nowhere — any key, any value, any dotted scope path could be injected through
`ConfigInput` straight into the evaluation scope.

## Decision

Two disjoint failure channels, split by who shaped the failing data:

- **AUTHOR-time (vendor-shaped data) → throw.** Unparseable expressions,
  unknown refs/functions, duplicate part paths (I9), ambiguous catalog
  matches, unit mismatches between a rule and its resolved component.
  Primary surface: **`validateRelease(release, catalog?)`** — the publish
  gate; fixtures run it, so authoring errors die in CI, before publish.
  What it cannot see statically (expression-driven resolution) throws at
  derive time.
- **CONFIG-time (user-shaped data) → typed `Issue`, never a raw throw.**
  `Issue = {key, severity, scope, params?}` where `key` is the i18n message
  key and `params` the interpolation payload (validator-keys discipline).
  Sources: the **input gate** (`gateInput` — key ∈ parameters, no dotted
  keys, `vendor` adjustability unwritable (I7), type + domain checks),
  option selection, constraint evaluation, and catalog resolution gaps.
  The pipeline returns `isValid: false` with the full issue list — no
  partial BOM, no silent zeros (I5).

Supporting choices:

- **Parameter `domain` is enforced at the gate**, so the four slice-1
  constraints that duplicated domains as range/enum expressions are deleted.
  Constraints now carry only judgment limits (warn thresholds, engineering
  rules) — the domain is the hard envelope, constraints live inside it.
- **`ParameterDef.default` split into `default` (literal) + `defaultExpr`**:
  a string literal and a serialized expression are indistinguishable at
  runtime (releases are stored data; a TS brand does not survive JSON), so
  the schema must discriminate. Found the hard way: a `select` default
  `"alu"` evaluated as a reference.
- **Expr `==`/`!=` across mismatched types throws** instead of returning
  false — comparing a select's string id to a number is always an authoring
  bug, never a meaningful comparison.
- `sumByCategory` throws on an unpriced part (`?? 0` deleted — I5).

## Consequences

- The generated configurator (step 6) renders Issues directly: `key` → ICU
  message, `params` → interpolation values. No error-string parsing, ever.
- `Issue.key` strings (`engine.input.*`, `engine.option.*`,
  `engine.catalog.*`, plus constraint keys) are part of the model↔UI
  contract; renaming one is a breaking change to the i18n catalogs.
- The cascade layers arriving in step 3 (tenant/customer/quote overrides)
  reuse the same gate: an override write is config-time by definition and
  validates against `adjustability` + `deviation` the same way input does.
