import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

/**
 * Testcontainers integration suite (spec §14) — deliberately a
 * SEPARATE config from `vitest.config.ts`:
 *
 * - `include` is `test/«*».itest.ts` only, and the unit config's
 *   `**slash*.test.ts` glob never matches `.itest.ts` — `pnpm test` stays
 *   fast and container-free, `pnpm test:integration` is the heavy suite.
 *   (Not merged onto `@repo/vitest-config/base`: mergeConfig APPENDS
 *   `include` arrays, which would pull every unit test into this run.)
 * - `globalSetup` boots ONE Postgres 17 + ONE Redis 7 container for the
 *   whole run, applies the full migration chain, and exports
 *   DATABASE_URL/REDIS_URL (see `test/setup/containers.ts`). Requires a
 *   Docker daemon — nothing else.
 * - NO parallelism across files: each itest file boots the real AppModule
 *   (and the privacy one a WorkerModule on live BullMQ consumers) against
 *   the SHARED containers — concurrent files would race queue consumption
 *   and DB state. One file at a time is the contract.
 * - Generous timeouts: container startup (first run pulls images) and real
 *   network round-trips dwarf unit-test budgets.
 */
export default defineConfig({
  plugins: [
    // Same SWC transform as the unit config: NestJS needs
    // `emitDecoratorMetadata`, which esbuild cannot emit.
    swc.vite({
      jsc: {
        parser: { syntax: "typescript", decorators: true, tsx: true },
        transform: { decoratorMetadata: true, react: { runtime: "automatic" } },
        target: "esnext",
      },
      module: { type: "es6" },
    }),
  ],
  test: {
    include: ["test/**/*.itest.ts"],
    globalSetup: ["./test/setup/containers.ts"],
    // Containers are heavy and SHARED — never run itest files in parallel.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
    teardownTimeout: 60_000,
  },
});
