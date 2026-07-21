import { describe, expect, it } from "vitest";

import { NAV_ENTRIES } from "../../lib/nav-registry";
import { navCountFor } from "./nav-badge";

const quotes = NAV_ENTRIES.find((e) => e.key === "quotes")!;
const dashboard = NAV_ENTRIES.find((e) => e.key === "dashboard")!;

describe("navCountFor", () => {
  it("returns the count for a pill-source entry", () => {
    expect(navCountFor(quotes, { quotes: 3 })).toBe(3);
  });

  it("returns undefined for a zero count — an empty pill is worse than none (§4.1)", () => {
    expect(navCountFor(quotes, { quotes: 0 })).toBeUndefined();
  });

  it("returns undefined when the count source is absent (no pill, not zero)", () => {
    expect(navCountFor(quotes, {})).toBeUndefined();
  });

  it("returns undefined for an entry that carries no countKey", () => {
    expect(navCountFor(dashboard, { quotes: 3 })).toBeUndefined();
  });
});
