// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Lint-the-lint guard for the `no-restricted-imports` allow-list (ADR 0011).
 *
 * The deep-import ban (`@repo/PKG/SUB`, `@repo/PKG/SUB/**`) is re-opened for the
 * public subpaths with `!` negations, which the `ignore` lib evaluates with
 * gitignore semantics: a negated child re-opens ONLY if its PARENT dir is also
 * re-allowed. So `!@repo/config/env/web` is INERT without `!@repo/config/env` —
 * an intermediate that has no bare export of its own and so looks "unused".
 * Deleting it as a "dead negation" silently re-bans the child; in a repo with no
 * file importing that subpath, lint then stays green (a false all-clear) — the
 * exact trap behind the banked finding.
 *
 * This guard fails fast if any negation at subpath-depth >= 2 is missing its
 * immediate parent negation, so that trap can't ship green.
 */
const source = readFileSync(fileURLToPath(new URL("./base.js", import.meta.url)), "utf8");

const negations = [...source.matchAll(/"!(@repo\/[^"]+)"/g)].map((match) => match[1]);
const negationSet = new Set(negations);

// Subpath depth = path segments after the package name. Depth-1 sits directly
// under the (allowed) package root, so only depth >= 2 negations need a parent
// dir re-allowed first.
const childNegations = negations.filter((path) => (path?.split("/").length ?? 0) - 2 >= 2);

describe("no-restricted-imports negations keep their load-bearing parents (ADR 0011)", () => {
  it("parses the negation allow-list from base.js", () => {
    expect(negations.length).toBeGreaterThan(0);
    expect(negationSet.has("@repo/config/env")).toBe(true);
    expect(childNegations.length).toBeGreaterThan(0);
  });

  it.each(childNegations.map((path) => [path]))(
    "negation %s has its parent dir re-allowed (gitignore parent rule)",
    (path) => {
      const parent = path.split("/").slice(0, -1).join("/");
      expect(
        negationSet.has(parent),
        `"!${path}" is inert unless "!${parent}" precedes it — keep the parent negation`,
      ).toBe(true);
    },
  );
});
