import { baseConfig, extendConfig } from "@repo/vitest-config/base";

// Node package (no jsdom/React) — the shared base carries the runner config.
//
// Coverage scope (ADR 0025): the mock FIXTURES (`src/fixtures/**`, seed objects)
// and HANDLERS (`src/handlers/**`, MSW request handlers) are excluded from the
// coverage threshold. They are a test double: exercised by CONSUMERS (the web
// app's mock-mode dev + any suite that mounts the MSW server), not unit-tested
// in this package — a per-handler test would assert the mock against itself,
// which carries no signal. The mock FRAMEWORK (`src/core/**` router/dispatch/
// response-envelope + `src/config.ts`/`src/msw.ts`) is real logic and stays
// measured (currently ~98%). This keeps the gate honest — it guards the code
// with own-tests and does not manufacture a red over deliberately consumer-
// exercised doubles.
export default extendConfig(baseConfig, {
  test: { coverage: { exclude: ["src/fixtures/**", "src/handlers/**"] } },
});
