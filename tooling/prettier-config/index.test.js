// @vitest-environment node
import { describe, expect, it } from "vitest";

import config from "./index.js";

/**
 * Guard the @ianvs/prettier-plugin-sort-imports parser plugins. Setting
 * `importOrderParserPlugins` REPLACES the plugin's default (`["typescript",
 * "jsx"]`) rather than merging, so adding "decorators-legacy" (for apps/api's
 * NestJS decorators) silently drops "jsx" and the sort-imports babel parse then
 * skips EVERY .tsx file. This pins all three so a future edit can't re-drop one.
 */
describe("prettier-config — importOrderParserPlugins", () => {
  it("includes jsx so the sort-imports plugin runs on .tsx files", () => {
    expect(config.importOrderParserPlugins).toContain("jsx");
  });

  it("includes typescript and decorators-legacy (apps/api NestJS decorators)", () => {
    expect(config.importOrderParserPlugins).toContain("typescript");
    expect(config.importOrderParserPlugins).toContain("decorators-legacy");
  });
});
