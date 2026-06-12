import { describe, expect, it } from "vitest";

import { formatCurrency } from "./currency";
import { formatNumber, formatPercent } from "./number";

describe("formatNumber", () => {
  it("formats with grouping for the given locale", () => {
    expect(formatNumber(1234567.5, {}, "en-US")).toBe("1,234,567.5");
  });
});

describe("formatPercent", () => {
  it("formats a fraction as a percent", () => {
    expect(formatPercent(0.25, { maximumFractionDigits: 0 }, "en-US")).toBe("25%");
  });
});

describe("formatCurrency", () => {
  it("places the currency symbol per locale", () => {
    expect(formatCurrency(1234.5, "USD", "en-US")).toBe("$1,234.50");
  });
});
