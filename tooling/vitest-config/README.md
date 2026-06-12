# @repo/vitest-config

Shared Vitest config (ADR 0025): one home for the test-runner settings every web/shared package re-declared — the test glob, `passWithNoTests`, coverage, and the jsdom/React component block.

## Exports

- `@repo/vitest-config/base` — `baseConfig` (node packages): the `**/*.test.{ts,tsx}` glob, `passWithNoTests`, and v8 coverage (modest, ratcheting thresholds). Also `extendConfig(base, overrides)` — a thin `mergeConfig` wrapper so arrays append.
- `@repo/vitest-config/react` — `reactConfig`: `baseConfig` + `@vitejs/plugin-react`, `environment: "jsdom"`, the React `resolve.dedupe`, and the shared setup file.
- `@repo/vitest-config/setup/react` — the jsdom/RTL setup (jest-dom matchers + `afterEach(cleanup)`), referenced by `reactConfig`.

This is tooling — referenced from each `vitest.config.ts`, never imported in source, so it adds no `eslint-plugin-boundaries` runtime edge. Mobile uses Jest, not Vitest (ADR 0005).

## Usage

A node package's one-line `vitest.config.ts`:

```ts
export { baseConfig as default } from "@repo/vitest-config/base";
```

A component/jsdom package extends `reactConfig`; a package pulling in a transitive React (e.g. `@repo/api`, `apps/web`) additionally inlines it via `extendConfig(reactConfig, { test: { server: { deps: { inline: [...] } } } })`.

## Decisions

- [ADR 0025](../../docs/adr/0025-web-e2e-playwright-shared-vitest-config.md) — shared `tooling/vitest-config`; no `@repo/testing` grab-bag.
- [ADR 0005](../../docs/adr/0005-testing-two-runner-split.md) — Vitest for web + shared, Jest only for mobile; the `test` task is cached.
