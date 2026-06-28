// @vitest-environment node
// (reads source text off disk via import.meta.url → needs a real file:// URL,
// which the jsdom default environment does not provide.)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Bundle-safety guard (ADR 0018): the mock dispatcher + its demo-user fixtures
 * (emails, the `mock-signature` token minter) must NEVER reach the eagerly
 * loaded production server bundle. They are pulled ONLY through a dynamic
 * `import("@repo/api-mocks")` gated on `mocksEnabled` (false in prod), so they
 * land in a separate chunk the prod server never loads. A top-level static
 * `import … from "@repo/api-mocks"` would defeat that and ship the fixtures to
 * prod — this test fails fast if anyone re-introduces one.
 */
const source = readFileSync(
  fileURLToPath(new URL("./handle-api-request.ts", import.meta.url)),
  "utf8",
);

describe("handle-api-request bundle safety", () => {
  it("pulls @repo/api-mocks through a dynamic import", () => {
    expect(source).toMatch(/import\(\s*["']@repo\/api-mocks["']\s*\)/);
  });

  it("never statically imports the @repo/api-mocks barrel", () => {
    // The barrel re-exports the route handlers + fixtures; a static import drags
    // them into the always-loaded server entry. (Subpaths like
    // `@repo/api-mocks/msw` are a separate concern and not used here.)
    expect(source).not.toMatch(/^\s*import\s+[^;]*\bfrom\s+["']@repo\/api-mocks["']/m);
  });
});
