import { describe, expect, it } from "vitest";

import { formatQuoteNumber } from "./document-number.js";

describe("formatQuoteNumber", () => {
  it("pads the sequence to four digits within a year", () => {
    expect(formatQuoteNumber(2026, 1)).toBe("2026/0001");
    expect(formatQuoteNumber(2026, 42)).toBe("2026/0042");
    expect(formatQuoteNumber(2026, 9999)).toBe("2026/9999");
  });

  it("does not truncate a sequence beyond the pad width", () => {
    expect(formatQuoteNumber(2026, 10000)).toBe("2026/10000");
  });

  it("carries the document's own year (per-year series reset)", () => {
    expect(formatQuoteNumber(2027, 1)).toBe("2027/0001");
  });
});
