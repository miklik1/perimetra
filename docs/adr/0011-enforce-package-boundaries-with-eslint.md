# ADR 0011 — Enforce package boundaries with eslint-plugin-boundaries

**Status:** Accepted (2026-06-01) — mechanically enforces the dependency DAG
declared in [ADR 0008](0008-shared-package-boundaries.md).

## Context

ADR 0008 defines an acyclic dependency graph between workspace packages
(`apps → @repo/*`; `@repo/api → {validators, utils, config}`;
`@repo/validators → @repo/utils`; `@repo/utils`/`@repo/config` are leaves;
nothing depends on an app; no cycles). Nothing enforced it — a stray
`import { x } from "@repo/api"` inside `@repo/utils`, or a new cycle, would pass
CI silently and only surface later as a refactor headache. For a multi-year base
reused across projects, the layering needs a machine check, not just prose.

`pnpm install` already rejects cycles in the _declared_ `dependencies`, but not
in actual `import` statements (source-only packages resolve `@repo/*` to sibling
source regardless of what's in `package.json`). A lint rule closes that gap.

`eslint-plugin-boundaries` v6 (verified 2026-06-01, flat-config native) maps each
file to an element _type_ by path and governs which types may import which —
exactly the ADR 0008 matrix.

## Decision

**Add `eslint-plugin-boundaries` to `tooling/eslint/base.js` (so every package and
app inherits it) with `boundaries/dependencies` encoding the ADR 0008 matrix as
`default: "disallow"` + an allow-list per source type.**

- **Element types** map to the workspace layout via `mode: "full"` patterns
  matched against a fixed `boundaries/root-path` (the monorepo root, computed
  from `base.js`'s location) — necessary because `eslint` runs per-package with
  the package dir as cwd. Types: `app` (`apps/*/**`) and one per package
  (`packages/<name>/**`).
- **Resolution** uses `eslint-import-resolver-typescript` (`import/resolver`),
  which resolves bare `@repo/*` specifiers into sibling package **source**.
  node_modules imports resolve outside `root-path` and are treated as external —
  this rule governs only workspace element→element edges.
- **Allowed edges** (each type may also import its own type — intra-package
  relative imports are same-type element dependencies in v6):
  - `app` → api, ui, validators, utils, config, navigation
  - `api` → validators, utils, config
  - `ui` → utils, config
  - `navigation` → utils, config
  - `validators` → utils
  - `utils`, `config` → (leaves; own type only)
- Everything else is disallowed by default. The current graph passes with zero
  violations; the rule is a guardrail against regressions.

`onlyWarn` downgrades the rule to a warning, but `eslint . --max-warnings 0`
(every package's lint script, run in CI) fails on it — verified with a deliberate
`utils → api` import.

## Consequences

- Illegal cross-package imports and new cycles fail `lint` (hence CI) at the
  point of introduction, with a message naming the offending edge.
- Adding a package or a legitimate new edge is a deliberate edit to this matrix
  in `base.js` (and a note here) — boundaries changes become reviewable.
- `import/extensions` is intentionally **not** added: packages are consumed as
  source with extension-less specifiers (the Expo config-loader constraint is
  handled by keeping that module free of workspace-source imports, not by
  rewriting every relative import).
- Slight lint-time cost from import resolution; negligible at this repo size.

## Sources

- https://www.jsboundaries.dev/docs/rules/dependencies (v6 `boundaries/dependencies`)
- https://www.jsboundaries.dev/docs/setup/settings/ (`boundaries/root-path`, elements, `import/resolver`)
- https://www.jsboundaries.dev/docs/releases/migration-guides/v5-to-v6/ (rule rename, object selectors)
- [ADR 0008](0008-shared-package-boundaries.md) (the dependency DAG being enforced)
