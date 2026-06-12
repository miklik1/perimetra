# Design — Scaffolding generators (`turbo gen`)

**Date:** 2026-06-04
**Status:** Implemented — `@turbo/gen` generators (`package` / `api-resource` /
`route`) in `turbo/generators/`, run via `pnpm gen` (ADR 0024)
**Decision record:** [ADR 0024](../../adr/0024-scaffolding-generators-turbo-gen.md)

## Goal

Make the skeleton's repetitive, convention-encoding tasks one command, with the
ADR 0008/0011 wiring enforced at creation. Three generators via `@turbo/gen`.

## Tooling & layout

- Add `@turbo/gen` (root devDep) + root script `"gen": "turbo gen"`.
- `turbo/generators/config.ts` — the Plop config (`export default function
(plop) {...}`), registering the generators below. Templates in
  `turbo/generators/templates/`.
- Run: `pnpm gen package` / `pnpm gen api-resource` / `pnpm gen route`.

## Anchor comments (one-time prep)

Plop `modify`/`append` actions inject at explicit anchors added once:

- `tooling/eslint/base.js`:
  - `// @gen:boundaries-elements` — end of the `boundaries/elements` array.
  - `// @gen:boundaries-rules` — end of the `rules` array.
  - `// @gen:app-allow` — inside the `from: { type: "app" }` allow list.
- `knip.json`: `// @gen:workspaces` anchor (JSONC — knip config already allows
  comments).
- Barrels: `// @gen:exports` in `@repo/validators`, `@repo/api`,
  `@repo/api-mocks`, `@repo/navigation` index/registry files.

## Generator 1 — `package`

**Prompts:** `name` (kebab; → `@repo/<name>`), `description`, `needsReact`
(boolean), `internalDeps` (checkbox: utils, config, validators, store, api,
api-mocks, ui, navigation, i18n, telemetry).

**Creates `packages/<name>/`:**

- `package.json` — `@repo/<name>`, `type: module`, `private`, `sideEffects:
false`, `exports: { ".": "./src/index.ts" }`, scripts `lint`/`check-types`/
  `test`, devDeps `@repo/eslint-config`, `@repo/typescript-config`, `eslint`,
  `typescript`, plus `@types/react` (if `needsReact`) or `@types/node`; selected
  `internalDeps` added as `workspace:*`.
- `tsconfig.json` — extends `@repo/typescript-config/react-native-library.json`
  (neutral/RN-safe default, matching `@repo/utils`), `types: ["node"]` unless
  `needsReact`.
- `vitest.config.ts` — standard (jsdom + plugin-react only if `needsReact`,
  mirroring `@repo/ui`).
- `src/index.ts` (+ `src/index.test.ts` placeholder).

**Modifies (auto-wire):**

- `tooling/eslint/base.js` — at `@gen:boundaries-elements`: `{ type: "<name>",
mode: "full", pattern: "packages/<name>/**" }`; at `@gen:boundaries-rules`: `{
from: { type: "<name>" }, allow: [<self + internalDeps>].map((type) => ({ to: {
type } })) }`; at `@gen:app-allow`: add `"<name>"`.
- `knip.json` — at `@gen:workspaces`: `"packages/<name>": {}`.

**Prints:** reminder to add any external deps to the right `pnpm-workspace.yaml`
catalog (generator can't pick versions).

## Generator 2 — `api-resource`

**Prompts:** `resource` (singular, e.g. `post`), `fields` (name:type list, light).

**Creates / modifies (three packages, mirroring the `users` slice):**

- `packages/validators/src/<resource>.ts` — `xSchema` (zod), `X` type,
  `xListSchema`, `xPageSchema` (`{ data, nextPage }`), `createXSchema =
xSchema.pick(...)`, `CreateXInput`. Export at `@repo/validators` barrel
  `@gen:exports`.
- `packages/api/src/endpoints/<resource>.ts` — `createXQueries(client)` using
  `defineQuery` (list + detail) + `defineMutation` (create), reading schemas from
  `@repo/validators`. Add keys to `packages/api/src/keys.ts` (`@gen:exports`
  anchor in the keys factory) and `export { createXQueries }` at the api barrel.
- `packages/api-mocks/src/fixtures/<resource>.ts` — synthetic data +
  list/get/create helpers (mirror `fixtures/users.ts`).
- `packages/api-mocks/src/handlers/<resource>.ts` — `xRoutes: MockRoute[]`
  (list `/x` incl. paged before `/x/:id`, detail, create), mirroring
  `handlers/users.ts`. Register in `packages/api-mocks/src/config.ts`
  `routeGroups` (`@gen:exports`) and export at the barrel.

**Prints:** reminder to add the resource to `NEXT_PUBLIC_MSW_MOCKS` /
`.env.example` if it should mock by default.

## Generator 3 — `route` (web + mobile)

**Prompts:** `name` (route key), `path` (e.g. `/posts/:id`), `platforms`
(web / mobile / both), `hasSearch` (boolean → zod search schema stub),
`authGated` (boolean).

**Creates:**

- web: `apps/web/app/<segment>/page.tsx` (RSC; if `authGated`, the protected
  pattern from `/account`) + optional `<segment>-client.tsx` ("use client" leaf).
- mobile: `apps/mobile/app/<segment>.tsx` (or dir) screen stub.

**Modifies:**

- `packages/navigation/src/routes.ts` — at `@gen:exports`: add the registry entry
  `<name>: { path: "<path>"${hasSearch ? ", search: z.object({ … })" : ""} }`
  (ADR 0022 search schema when requested).

**Prints:** if `authGated`, reminder to add the path to `apps/web/proxy.ts`'s
gate list.

## Testing the generators

- A smoke test (CI step or vitest) runs each generator into a temp dir / scratch
  workspace and asserts the output **passes `lint` + `check-types`** — so a
  template that drifts from the conventions fails CI. (At minimum, document the
  manual `pnpm gen` + `pnpm turbo lint check-types` verification.)
- The `package` generator's base.js edits are validated by running `eslint` on
  the generated package (boundaries rule present → no "disallowed import" false
  errors; missing element → lint error).

## Out of scope / deferred

- `ui-component` and `adr` generators (lower frequency).
- Catalog version selection (manual — generator can't pick versions).
- Modifying CI matrices / turbo.json (new packages are globbed already).

## DAG / boundaries impact

None at runtime — generators live in `turbo/generators/` (tooling, not a
workspace package) and only emit/modify source. The `package` generator is what
keeps the DAG correct as packages are added.

## Files (for the plan)

**New:** `turbo/generators/config.ts`, `turbo/generators/templates/**`
(package/api-resource/route template trees).

**Changed (anchors):** `tooling/eslint/base.js`, `knip.json`,
`packages/validators/src/index.ts`, `packages/api/src/{keys.ts,index.ts}`,
`packages/api-mocks/src/{config.ts,index.ts}`,
`packages/navigation/src/routes.ts`; root `package.json` (`gen` script +
`@turbo/gen` devDep); `docs/adr/0024-*.md`, `docs/adr/README.md`,
`ARCHITECTURE.md`.
