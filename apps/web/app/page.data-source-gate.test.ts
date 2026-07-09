// @vitest-environment node
// (reads page.tsx source off disk via import.meta.url → needs a real file:// URL,
// which the jsdom environment does not provide.)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The home-page RSC prefetch gate (`hasDataSource`) decides whether the server
 * prefetches the demo list. It carries the same tier conjunct as the BFF mock
 * gate: a Vercel PREVIEW deploy builds with NODE_ENV=production, so a NODE_ENV
 * gate would silently drop the prefetch on preview even while the (tier-gated)
 * BFF is serving mocks. This source-read guard pins the fix against a silent
 * refactor back to NODE_ENV (vault finding "Multi-tier Vercel (Next) deploy …").
 */
const source = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf8");

describe("home page data-source gate keys off TIER, not NODE_ENV", () => {
  it("gates the mock prefetch branch on TIER !== 'prod'", () => {
    expect(source).toMatch(/TIER\s*!==\s*["']prod["']/);
  });

  it("no longer keys the prefetch gate off process.env.NODE_ENV", () => {
    expect(source).not.toMatch(/process\.env\.NODE_ENV\s*!==\s*["']production["']/);
  });
});
