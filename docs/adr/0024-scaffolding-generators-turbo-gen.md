# ADR 0024 — Scaffolding generators with `@turbo/gen` (auto-wired package / api-resource / route)

**Status:** Accepted (2026-06-04). Operationalizes the "bounded per-package
cost" accepted in [ADR 0008](0008-shared-package-boundaries.md) and the DAG of
[ADR 0011](0011-enforce-package-boundaries-with-eslint.md).

## Context

This skeleton is reused across many projects for years and deliberately favors
many small single-responsibility packages (ADR 0008). That makes two actions
frequent and repetitive — and therefore error-prone:

- **Adding a package** touches `package.json`, `tsconfig.json`,
  `vitest.config.ts`, **`tooling/eslint/base.js` (a boundaries _element_ + a
  dependency _rule_ + the app allow-list)**, and `knip.json`. Miss the base.js
  wiring and the package either has no boundary enforcement or fails lint.
- **Adding a REST resource** spans three packages in lockstep: a zod schema in
  `@repo/validators`, an endpoint module + query-keys in `@repo/api`, and a mock
  route in `@repo/api-mocks` (ADR 0007/0018).

These are exactly the mechanical, convention-encoding tasks a generator should
own — both to remove the cost and to make the conventions executable rather than
tribal.

## Decision

**Adopt `@turbo/gen`** (Plop-based, native to Turborepo; config in
`turbo/generators/config.ts`, TS templates, run via `turbo gen <name>` / a root
`pnpm gen`). Ship three generators, with the `package` one **fully auto-wiring**
the cross-cutting registration:

1. **`package`** — scaffolds `packages/<name>` (`@repo/<name>`: package.json,
   tsconfig extending `@repo/typescript-config`, vitest, `src/index.ts`) **and
   edits** `tooling/eslint/base.js` to add the boundaries element + a dependency
   rule (prompting which internal packages it may import) + the app allow-list,
   **and** adds the `knip.json` workspace entry. Prompts: name, description,
   needs-React, allowed internal deps.
2. **`api-resource`** — one command across three packages: zod schema +
   inferred/create/page types in `@repo/validators/src/<resource>.ts`;
   `createXQueries` endpoint module (via `defineQuery`/`defineMutation` builders)
   - query-keys in `@repo/api`; a `MockRoute[]` handler + fixtures in
     `@repo/api-mocks` registered in its route groups — mirroring the existing
     `users` slice.
3. **`route`** (web + mobile) — `apps/web/app/<route>/page.tsx` (RSC, optional
   client leaf) and/or `apps/mobile/app/<route>`, **registering the route in
   `@repo/navigation`'s registry** (path + optional zod search schema per
   ADR 0022). Prompts: route name, path, platform(s), search params, auth-gated.

**Auto-wiring via anchor comments.** File edits use Plop `modify` actions keyed
to dedicated anchor comments added once to `tooling/eslint/base.js` (elements
array, rules array, app allow-list), `knip.json` (workspaces), and the barrels
(`@repo/validators`, `@repo/api`, `@repo/api-mocks`, `@repo/navigation`). Anchors
make the injection points explicit and stable.

**Not included now:** `ui-component` and `adr` generators (deferred; lower
frequency). External-dependency **catalog** entries stay manual — a generator
cannot know the right version — so generators print a reminder when a new
external dep is implied.

## Consequences

- Creating a correctly-wired package or a three-package resource becomes one
  command, with the ADR 0008/0011 discipline enforced at creation instead of
  remembered. The biggest compounding DX win for a reused base.
- Conventions become **executable**: the generator templates are now a second
  source of truth for "how a package/resource looks," so they **must be updated
  when a convention changes** (a real, bounded maintenance cost — the templates
  live next to the code they emit and are covered by the same lint/type checks
  when run).
- Anchor comments add a little noise to `base.js` / `knip.json` / barrels, in
  exchange for stable, reviewable injection points.
- A generated artifact still runs the full suite (`lint` / `check-types` /
  `test`), so a drifted template fails CI like any other code.

## Sources

- Turborepo code generators (`@turbo/gen`, `turbo gen`, Plop foundation):
  <https://turborepo.com/docs/guides/generating-code> (verified 2026-06-04).
- [ADR 0008](0008-shared-package-boundaries.md) (per-package cost),
  [ADR 0011](0011-enforce-package-boundaries-with-eslint.md) (the DAG the
  `package` generator writes), [ADR 0007](0007-rest-data-layer.md) /
  [ADR 0018](0018-bff-route-handler-and-shared-mocks.md) (the resource+mock shape
  the `api-resource` generator emits), [ADR 0022](0022-typed-search-params-route-dx.md)
  (route search schema the `route` generator scaffolds).
