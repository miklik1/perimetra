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
    // `{ env, TIER }` — the mock rewrites gate reads TIER; match env in any
    // named-import list, not `{ env }` exactly.
    expect(source).toMatch(
      /import\s+\{[^}]*\benv\b[^}]*\}\s+from\s+["']@repo\/config\/env\/web["']/,
    );
  });

  it("gates Sentry source-map emission on SENTRY_AUTH_TOKEN (no token → no maps shipped)", () => {
    expect(source).toMatch(/sourcemaps:\s*\{\s*disable:\s*!env\.SENTRY_AUTH_TOKEN\s*\}/);
  });

  it("gates the mock rewrites on the deployment TIER, not NODE_ENV (Vercel builds preview with NODE_ENV=production)", () => {
    expect(source).toMatch(/mocksEnabled\s*=\s*TIER\s*!==\s*["']prod["']/);
    // The pre-fix NODE_ENV gate must be gone from the mock gate, or the
    // /api/auth/* + /api/v1/* rewrites bypass the mock route on a preview deploy.
    expect(source).not.toMatch(/env\.NODE_ENV\s*!==\s*["']production["']/);
  });

  it("runs the build-time tier-invariant guard at config load (gate at build AND runtime)", () => {
    expect(source).toMatch(
      /import\s+\{\s*assertTierInvariants\s*\}\s+from\s+["']@repo\/config\/env\/assert-tier-invariants["']/,
    );
    expect(source).toMatch(/^assertTierInvariants\(\);/m);
  });
});
