// @vitest-environment node
// (reads next.config.js source off disk via import.meta.url → needs a real
// file:// URL, which the jsdom environment does not provide.)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * next.config.js asserts two build-time behaviors in prose comments only; the
 * runtime guarantees are exercised by the prod build + the e2e suite, but a
 * refactor could silently drop the wiring. These source-read guards pin it.
 */
const source = readFileSync(fileURLToPath(new URL("./next.config.js", import.meta.url)), "utf8");

describe("next.config build-time wiring", () => {
  it("imports the web env module at config time (a bad NEXT_PUBLIC_* fails the build, not the first request)", () => {
    expect(source).toMatch(/import\s+\{\s*env\s*\}\s+from\s+["']@repo\/config\/env\/web["']/);
  });

  it("gates Sentry source-map emission on SENTRY_AUTH_TOKEN (no token → no maps shipped)", () => {
    expect(source).toMatch(/sourcemaps:\s*\{\s*disable:\s*!env\.SENTRY_AUTH_TOKEN\s*\}/);
  });
});
