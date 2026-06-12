import { extendConfig } from "@repo/vitest-config/base";
import { reactConfig } from "@repo/vitest-config/react";

// jsdom + React (shared base) plus the web-app extras:
// - inline `@tanstack/react-query` so Vite owns its module resolution (pnpm's
//   isolated node_modules can hoist a second react under it, breaking the
//   single-instance hooks invariant under Vitest's resolver).
// - an additional setup file that stands up the MSW node server (ADR 0018) on
//   top of the shared jest-dom/cleanup setup. mergeConfig appends, so both the
//   shared `setup/react` and this local `vitest.setup.ts` run.
export default extendConfig(reactConfig, {
  test: {
    setupFiles: ["./vitest.setup.ts"],
    server: { deps: { inline: ["@tanstack/react-query"] } },
  },
});
