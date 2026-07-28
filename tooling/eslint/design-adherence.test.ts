// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  designAdherenceConfig,
  designAdherenceEntries,
  enforcedAdherenceEntries,
} from "./design-adherence.js";

/**
 * Guards the design-adherence gate against the one failure that matters: passing
 * while auditing nothing (ADR 0137, the ADR 1029 lesson applied to this gate).
 *
 * The module reads its rules from the design export rather than restating them, so
 * a re-export can change what is enforced without anyone editing code here. That is
 * the point, and it is also the risk — these tests pin the properties that must hold
 * whatever the export says.
 */
describe("design adherence rules", () => {
  it("reads real entries from the export, every one with a selector and a message", () => {
    const entries = designAdherenceEntries();
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(typeof entry.selector).toBe("string");
      expect(entry.selector.length).toBeGreaterThan(0);
      expect(typeof entry.message).toBe("string");
    }
  });

  it("still carries all three checks the export is expected to ship", () => {
    // Anti-vacuity: if a re-export drops one of these, `designAdherenceEntries`
    // throws rather than letting the gate silently shrink. Asserted through the
    // public function so the test fails for the same reason the build would.
    const selectors = designAdherenceEntries().map((e) => e.selector);
    expect(selectors.some((s) => s.includes("#[0-9a-fA-F]"))).toBe(true);
    expect(selectors.some((s) => s.includes("px"))).toBe(true);
    expect(selectors.some((s) => s.includes("font-family"))).toBe(true);
  });

  it("enforces the hex and font checks, and excludes the raw-px one", () => {
    // The px check is deliberately unenforced (Tailwind arbitrary values are the
    // sanctioned escape hatch; ADR 0114 §7.1 declined to tokenise spacing). It must
    // still be READ — that is what makes the anti-vacuity check above meaningful.
    const enforced = enforcedAdherenceEntries().map((e) => e.selector);
    expect(enforced.some((s) => s.includes("#[0-9a-fA-F]"))).toBe(true);
    expect(enforced.some((s) => s.includes("font-family"))).toBe(true);
    expect(enforced.some((s) => s.includes("\\d+px"))).toBe(false);
    expect(enforced.length).toBeGreaterThan(0);
  });

  it("builds a flat-config block that actually turns the rule on as an error", () => {
    const block = designAdherenceConfig({ files: ["src/**/*.tsx"], ignores: ["**/*.test.tsx"] });
    expect(block.files).toEqual(["src/**/*.tsx"]);
    expect(block.ignores).toEqual(["**/*.test.tsx"]);

    const rule = block.rules["no-restricted-syntax"];
    expect(rule[0]).toBe("error");
    // Severity plus at least one real entry — a bare ["error"] would lint nothing.
    expect(rule.length).toBeGreaterThan(1);
  });

  it("defaults ignores to empty rather than dropping the key", () => {
    // A missing `ignores` must not become `undefined` in a flat-config block.
    const block = designAdherenceConfig({ files: ["src/**/*.tsx"] });
    expect(block.ignores).toEqual([]);
  });
});
