/**
 * Vitest config for the local ESLint plugin rules.
 *
 * The rule + test files are plain `.js` (ESM) — no TypeScript compiler config
 * needed here. We extend the shared base config but override `include` to
 * also pick up `.test.js` files alongside the repo-standard `.test.ts`.
 *
 * The shared `baseConfig.test.include` only covers `.test.{ts,tsx}`. Extending
 * here avoids forking the rest of the shared settings (coverage thresholds,
 * passWithNoTests, etc.).
 */
import { baseConfig, extendConfig } from "@repo/vitest-config/base";

export default extendConfig(baseConfig, {
  test: {
    // Include plain-JS rule tests alongside any future TS tests.
    include: ["**/*.test.{ts,tsx,js}"],
  },
});
