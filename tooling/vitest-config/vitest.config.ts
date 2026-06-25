/**
 * Self-test config for `@repo/vitest-config`. Deliberately standalone (does NOT
 * extend its own `base`) so the package's guard tests run in plain node with no
 * coverage-threshold inheritance — they only read source to pin the
 * CPU-contention timeout values (see base.test.ts).
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
  },
});
