import react from "@vitejs/plugin-react";
import { defineConfig, mergeConfig, type ViteUserConfig } from "vitest/config";

// Self-reference through the package's own export map (not a relative `./base`):
// the bare specifier resolves cleanly under both Node ESM (exports → base.ts)
// and TypeScript's Bundler resolution, with no file extension to reconcile.
import { baseConfig } from "@repo/vitest-config/base";

/**
 * Shared jsdom + React component-test config (ADR 0025) — the block `@repo/ui`,
 * `@repo/auth`, `@repo/flags`, `@repo/api`, and `apps/web` each copy-pasted:
 * `@vitejs/plugin-react`, `environment: "jsdom"`, the React `resolve.dedupe`,
 * and the jest-dom/cleanup setup file.
 *
 * Dedupe React so RTL renders against a single instance — pnpm's isolated
 * `node_modules` can otherwise surface a second `react` copy under a transitive
 * dep (e.g. `@tanstack/react-query/node_modules/react/`), breaking the
 * single-instance hooks invariant under Vitest's resolver. A package that pulls
 * in such a transitive React (e.g. `@repo/api`, `apps/web`) additionally inlines
 * it via `extendConfig(reactConfig, { test: { server: { deps: { inline: [...] }}}})`
 * so Vite owns its resolution end-to-end.
 */
export const reactConfig: ViteUserConfig = mergeConfig(
  baseConfig,
  defineConfig({
    plugins: [react()],
    resolve: { dedupe: ["react", "react-dom"] },
    test: {
      environment: "jsdom",
      setupFiles: ["@repo/vitest-config/setup/react"],
    },
  }),
);
