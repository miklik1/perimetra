# ADR 0005 — Vitest for web + shared packages; Jest/jest-expo for mobile; Maestro E2E

**Status:** Accepted (2026-05-26) — simplified for the split-UI model;
unit runner implemented (2026-06-01, SDK 56). E2E (Maestro/EAS) scaffolded,
not yet wired to a linked EAS project. **Amended 2026-06-04 by
[ADR 0025](0025-web-e2e-playwright-shared-vitest-config.md): adds Playwright as
the web E2E runner (mock-mode) — the split is now four runners.**

## Context

There is no reliable Vitest support for React Native / Expo in 2026 (Expo docs,
updated 2026-05-18, describe only jest-expo + `@testing-library/react-native`;
`vitest-react-native` is community-maintained and unreliable). So RN code needs
Jest.

Under the split-UI model ([ADR 0006](0006-split-ui-web-dom-mobile-rn.md)) the
runner split is cleaner than under the old shared-RN-UI model: **no shared
package imports `react-native`.** Web UI is DOM, shared packages are pure
TS/DOM. Only `apps/mobile` is React Native.

## Decision

| Package                                         | Runner                                                                           |
| ----------------------------------------------- | -------------------------------------------------------------------------------- |
| `apps/web`                                      | Vitest 4 + `@testing-library/react` + jsdom                                      |
| web UI package + `@repo/*` logic/api/validation | Vitest 4 (jsdom or node)                                                         |
| `apps/mobile`                                   | **Jest + jest-expo + @testing-library/react-native** + expo-router testing utils |

- Vitest is the default everywhere except `apps/mobile`. Jest is confined to the
  one React Native app.
- Install RN test deps via `npx expo install jest-expo
@testing-library/react-native` so versions track the SDK (the skeleton runs
  RN 0.84, ahead of SDK 55 stock — never hand-pin).
- Test config per package; co-locate tests with source.
- **E2E: Maestro via EAS Workflows** (`.maestro/` flows + `.eas/workflows/` job +
  an `e2e-test` EAS build profile). Expo-recommended; lower long-term
  maintenance than Detox. Skip Detox until a gray-box need appears.
- **`turbo.json` `test` task: enable caching** with `outputs: ["coverage/**"]`
  (current `cache:false` forfeits the biggest CI saver). Separate non-cached
  `test:e2e` gated to CI/PR via EAS Workflows.
- Add `npx expo install --check` to CI to enforce SDK version alignment
  ([ADR 0002](0002-reanimated-4-retained.md)).

## Implementation (2026-06-01, Expo SDK 56)

The figures in the Decision above were the SDK-55 decision-time data. As shipped
on SDK 56:

- **Unit runner.** `pnpm --filter mobile exec expo install --save-dev jest-expo
@testing-library/react-native jest @react-native/jest-preset`. `expo install`
  resolved `jest-expo ~56.0.4` (from `bundledNativeModules`) and
  `@react-native/jest-preset ~0.85.3` — both moved into the `expo56` catalog
  (they track the SDK). `@testing-library/react-native ^13.3.3` is in the
  default catalog (SDK-independent). **jest is hand-pinned to `^29.7.0`** in the
  default catalog: `expo install` defaults jest to latest (30.x), but jest-expo
  56's preset + `jest-watch-typeahead` require the jest 29 line.
  `jest-expo@56.0.4` pulls `react-test-renderer@19.2.3`, matching the repo's
  exact React pin — no React-19 renderer-deprecation breakage. Test files import
  typed globals from `@jest/globals` (declared devDep), mirroring the web Vitest
  style (`import { describe, it } from "vitest"`).
- **Config.** `apps/mobile/jest.config.cjs` = `preset: "jest-expo"` +
  `setupFiles` (sets `SKIP_ENV_VALIDATION`) + a `moduleNameMapper` stubbing
  `*.css` (NativeWind v5 compiles CSS through Metro, which Jest bypasses).
  `transformIgnorePatterns` is **not** overridden — the preset already whitelists
  `.pnpm`, and `@repo/*` source lives outside `node_modules`, so both transpile.
- **Tests.** UI primitives (`Button`/`Text`/`Stack`/`gapClass`) are co-located
  in `components/ui/`. The route test (`__tests__/home.test.tsx`) uses
  `expo-router/testing-library` `renderRouter` and lives **outside `app/`** —
  expo-router does not ignore `*.test.tsx`, so co-locating would create a phantom
  `/index.test` route in `expo export`.
- **Turbo.** `test` caching is already on (inputs-hashed; the Decision's
  `cache:false` premise was stale). `outputs` stays `[]`: no runner emits
  coverage artifacts yet, so listing `coverage/**` only produces turbo
  "no output files" warnings. Add it back the day `--coverage` is turned on
  across the runners (jest is free; Vitest needs `@vitest/coverage-v8`).
- **E2E (scaffolded, not yet active).** `apps/mobile/.maestro/smoke.yml`,
  `eas.json` (`e2e-test` profile: iOS simulator + Android apk), and
  `.eas/workflows/e2e-test.yml` (per-platform build → `maestro` job). Native
  identifiers (`ios.bundleIdentifier` / `android.package` = `cz.bepositive.mobile`)
  added to `app.config.ts` and matched by the Maestro `appId`. A non-cached
  `test:e2e` script runs Maestro locally. Activation needs `eas init` to link a
  project + a device/cloud runner — it cannot run on the WSL2 dev box, so it is
  not part of `turbo test`.

## Consequences

- One runner (Vitest) covers web + all shared packages; Jest is isolated to
  mobile. Lower friction than sharing a Jest-tested RN UI package.
- Two runners remain, but the boundary is a single app, not scattered packages.
- Per-package config + Turbo caching = fast, independently upgradable CI.

## Sources

- https://docs.expo.dev/develop/unit-testing/ (jest-expo + RNTL; updated 2026-05-18)
- https://docs.expo.dev/eas/workflows/examples/e2e-tests/ (Maestro via EAS; updated 2026-04-20)
- https://github.com/callstack/react-native-testing-library/discussions/1142 (no official Vitest support)
- npm registry (2026-05-19): `jest-expo` sdk-55 55.0.18; `@testing-library/react-native` 13.3.3.
