/**
 * Self-test config for `@repo/prettier-config`. Standalone (does not extend the
 * shared base) so this pure-JS config package needs no TS toolchain — it only
 * guards the importOrderParserPlugins invariant (see index.test.js).
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.js"],
  },
});
