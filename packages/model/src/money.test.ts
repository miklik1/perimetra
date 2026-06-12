import { describe, expect, it } from "vitest";

import { toMoneyString } from "./money";

describe("toMoneyString (I10 — the lossless money boundary)", () => {
  it("is the 15-sig-digit canonical decimal of the computed double (Excel anchor semantics)", () => {
    expect(toMoneyString(81451.504)).toBe("81451.504");
    expect(toMoneyString(75174.2)).toBe("75174.2");
    expect(toMoneyString(12650)).toBe("12650");
  });

  it("erases sub-ulp accumulation noise — the bug class the boundary exists to stop", () => {
    // The real sliding-gate sum: Σ(line totals) drifts one ulp off the anchor.
    expect(toMoneyString(81451.50399999999)).toBe("81451.504");
    expect(toMoneyString(0.1 + 0.2)).toBe("0.3");
  });

  it("normalizes negative zero", () => {
    expect(toMoneyString(-0)).toBe("0");
  });

  it("throws on values that are not prices (author/data bugs, ADR 0047)", () => {
    expect(() => toMoneyString(Number.NaN)).toThrow(RangeError);
    expect(() => toMoneyString(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => toMoneyString(1e22)).toThrow(RangeError);
    expect(() => toMoneyString(1e-8)).toThrow(RangeError);
  });
});
