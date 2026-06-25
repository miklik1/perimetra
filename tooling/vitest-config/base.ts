import { defineConfig, mergeConfig, type ViteUserConfig } from "vitest/config";

/**
 * Shared Vitest base (ADR 0025) — the single home for the test-runner config
 * every package re-declared by hand (the `include` glob + `passWithNoTests`
 * pair, and for component suites the jsdom/`@vitejs/plugin-react`/`dedupe`/setup
 * block). It is *tooling*, referenced from each `vitest.config.ts`, never
 * imported in source — so it adds no `eslint-plugin-boundaries` runtime edge.
 *
 * Each package keeps a one-line `vitest.config.ts`: a node package extends
 * `baseConfig` directly; a component/jsdom package extends `reactConfig`
 * (./react). Per-package extras (extra `include` roots, `inline` deps) merge on
 * top via `extendConfig`.
 *
 * Inconsistencies the base resolves (per the quality-infra audit):
 * - `include` was a mix of a broad glob and a `src`-scoped one. The base uses
 *   the broad test glob (node_modules/dist are excluded by Vitest's defaults) so
 *   apps with tests outside `src` (apps/web: app, lib, i18n, mocks) and
 *   src-only packages share one rule.
 * - `passWithNoTests` was set on some packages and omitted on others. It is on
 *   uniformly here: a package with no tests yet must not fail the suite.
 */
export const baseConfig: ViteUserConfig = defineConfig({
  test: {
    include: ["**/*.test.{ts,tsx}"],
    passWithNoTests: true,
    // `turbo run test` fans every package's suite out at once; on a loaded box
    // the jsdom environment + Nest `bootApp()` setup can take much longer than
    // vitest's 5s default, so an otherwise-passing test trips it — and a
    // DIFFERENT suite each run (node AND jsdom). The suites pass isolated / at
    // `--concurrency=1`. Generous per-test + per-hook ceilings let contention
    // resolve without masking real problems: a true hang still fails (at the
    // ceiling) and a real assertion still fails immediately. (Channel-A drain
    // from skeleton f506bec; matches this repo's documented laptop flake.)
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Coverage (quality-infra spec §4, ADR 0025) — uniform across every package
    // that extends this base. The v8 provider is zero-config (uses Node's
    // built-in coverage); it only runs when a suite is invoked with
    // `--coverage` (CI does, local `pnpm test` does not), so day-to-day runs pay
    // nothing. Reporters: `text` for the CI log, `json`/`html` for the cached
    // `coverage/` artifact (declared as a turbo `test` output). Thresholds start
    // modest per the spec ("start modest, ratchet up") so the gate is real
    // without blocking on the skeleton's early, deliberately-thin suites.
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      // Exclude non-logic files so the percentage reflects testable code.
      exclude: [
        "**/*.config.{ts,js,mjs,cjs}",
        "**/*.test.{ts,tsx}",
        "**/index.ts",
        "**/*.d.ts",
        "**/dist/**",
      ],
      // Modest floors the current (deliberately-thin, exemplar) suites clear,
      // so the gate is real today and ratchets up as suites grow. Branches sit
      // lower than the rest: branch coverage is the hardest to hit and the
      // web app's RSC/error-path code drags it down (~44%) without the test
      // value justifying contrived branch tests yet.
      thresholds: {
        statements: 50,
        functions: 50,
        lines: 50,
        branches: 40,
      },
    },
  },
});

/**
 * Merge a package's own overrides onto a shared base (`baseConfig` or
 * `reactConfig`). Thin wrapper over Vitest's `mergeConfig` so call sites read as
 * an intent ("extend the shared base with these extras") and arrays append
 * rather than replace.
 */
export function extendConfig(base: ViteUserConfig, overrides: ViteUserConfig): ViteUserConfig {
  return mergeConfig(base, overrides);
}
