# @repo/eslint-config

Shared flat ESLint configs for the monorepo: a base (TypeScript + import boundaries + turbo + prettier) layered into per-runtime presets, enforcing the ADR 0008 dependency DAG (ADR 0011).

## Exports

- `@repo/eslint-config/base` — `baseConfig`: TS-ESLint, `eslint-plugin-boundaries` (the package DAG, matched against the repo root), `eslint-plugin-turbo`, `eslint-config-prettier`, `only-warn`.
- `@repo/eslint-config/node` — `nodeConfig`: base + Node globals (pure platform-neutral TS packages).
- `@repo/eslint-config/next-js` — `nextJsConfig`: base + React / hooks / a11y + `@next/eslint-plugin-next`.
- `@repo/eslint-config/react-internal` — `reactInternalConfig`: base + React / hooks (React libraries, browser globals).
- `@repo/eslint-config/expo` — `expoConfig`: base + React / hooks + RN globals (`__DEV__`, `fetch`, …).

## Usage

Each package ships a one-line flat config picking the right preset (mirrors the package `eslint.config.js` files). ESLint runs per-package (cwd = package dir):

```js
import { nodeConfig } from "@repo/eslint-config/node";

export default nodeConfig;
```

A React library uses `reactInternalConfig`; the Next app uses `nextJsConfig`; the Expo app uses `expoConfig`.

## Decisions

- [ADR 0011](../../docs/adr/0011-enforce-package-boundaries-with-eslint.md) — enforce the dependency DAG with `eslint-plugin-boundaries`.
- [ADR 0008](../../docs/adr/0008-shared-package-boundaries.md) — the boundary rules encode the package-separation DAG.

## Adding a package

`pnpm gen package` scaffolds the new package's `eslint.config.js` (node or react preset) and registers it in the boundaries element list so its edges are enforced.
