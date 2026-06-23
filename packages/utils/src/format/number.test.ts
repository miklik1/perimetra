import { describe, expect, it } from "vitest";

import { formatCurrency } from "./currency";
import { formatNumber, formatPercent } from "./number";

describe("formatNumber", () => {
  it("formats with grouping for the given locale", () => {
    expect(formatNumber(1234567.5, {}, "en-US")).toBe("1,234,567.5");
  });

  it("returns the empty string for non-finite input", () => {
    expect(formatNumber(NaN, {}, "en-US")).toBe("");
    expect(formatNumber(Infinity, {}, "en-US")).toBe("");
    expect(formatNumber(-Infinity, {}, "en-US")).toBe("");
  });
});

describe("formatPercent", () => {
  it("formats a fraction as a percent", () => {
    expect(formatPercent(0.25, { maximumFractionDigits: 0 }, "en-US")).toBe("25%");
  });

  it("returns the empty string for non-finite input", () => {
    expect(formatPercent(NaN, {}, "en-US")).toBe("");
    expect(formatPercent(Infinity, {}, "en-US")).toBe("");
  });
});

describe("formatCurrency", () => {
  it("places the currency symbol per locale", () => {
    expect(formatCurrency(1234.5, "USD", "en-US")).toBe("$1,234.50");
  });

  it("returns the empty string for non-finite input", () => {
    expect(formatCurrency(NaN, "USD", "en-US")).toBe("");
    expect(formatCurrency(Infinity, "USD", "en-US")).toBe("");
  });
});
