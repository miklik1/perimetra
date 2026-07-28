// @vitest-environment node
import { existsSync } from "node:fs";
import { isAbsolute } from "node:path";
import { format } from "prettier";
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

/**
 * Guard theme-aware Tailwind class sorting (ADR 1049). Its failure mode is
 * SILENT: prettier-plugin-tailwindcss swallows a failed stylesheet/`tailwindcss`
 * resolution in a bare `catch` and falls back to its bundled defaults, so every
 * `@theme` token becomes an "unknown class" and is hoisted to the FRONT of the
 * class list with no diagnostic anywhere. Nothing turns red; the sort just
 * quietly stops meaning anything.
 *
 * The behavioural assertion below is therefore the real check — it formats a
 * class list and asserts the tokens land in POSITION rather than at the front,
 * which is exactly what regresses. The two structural assertions pin the
 * preconditions so a failure says WHICH one broke.
 */
describe("prettier-config — theme-aware Tailwind class sorting", () => {
  it("points tailwindStylesheet at an ABSOLUTE path that exists", () => {
    // Relative is not merely fragile here, it is unfixable: the plugin resolves
    // the option against the resolved CONFIG FILE's directory (falling back to
    // the formatted file's), so no single relative path is correct repo-wide.
    expect(config.tailwindStylesheet).toBeDefined();
    expect(isAbsolute(config.tailwindStylesheet)).toBe(true);
    expect(existsSync(config.tailwindStylesheet)).toBe(true);
  });

  it("sorts @theme tokens into position instead of hoisting them to the front", async () => {
    const input = `<div className="text-muted-foreground flex bg-background p-4 items-center" />;\n`;
    const output = await format(input, {
      ...config,
      parser: "typescript",
      // The plugin derives its module-resolution base from the prettier CONFIG
      // FILE's directory, so it must be told one — in a real run that is the
      // repo root (the `"prettier"` key in the root package.json), which is
      // also the only place `tailwindcss` resolves from.
      filepath: new URL("../../apps/web/app/probe.tsx", import.meta.url).pathname,
    });

    // The unknown-class signature is tokens FIRST. Theme-aware sorting puts the
    // layout utilities first and the colour tokens in their proper slots.
    expect(output).not.toMatch(/className="text-muted-foreground/);
    expect(output).toMatch(/className="flex items-center/);
  });
});
