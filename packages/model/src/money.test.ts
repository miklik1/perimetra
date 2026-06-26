import { describe, expect, it } from "vitest";

import {
  addMoney,
  DEFAULT_ROUNDING_POLICY,
  mulMoney,
  percentOf,
  roundMoney,
  toMoneyString,
  type RoundingPolicy,
} from "./money.js";

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

const haler: RoundingPolicy = { scale: 2, mode: "half-up", granularity: "end-of-invoice" };
const halerEven: RoundingPolicy = { scale: 2, mode: "half-even", granularity: "end-of-invoice" };
const wholeCzk: RoundingPolicy = { scale: 0, mode: "half-up", granularity: "end-of-invoice" };

describe("roundMoney (exact-decimal commercial rounding, ADR 0081)", () => {
  it("rounds the re-baselined goldens to haléř, trimmed (the .504 → .5 move)", () => {
    expect(roundMoney(81451.504, haler)).toBe("81451.5");
    expect(roundMoney(129891.504, haler)).toBe("129891.5");
    expect(roundMoney(31548.504, haler)).toBe("31548.5");
    expect(roundMoney(1023.744, haler)).toBe("1023.74");
  });

  it("leaves already-haléř values unchanged (79039.86, 75174.2, integers)", () => {
    expect(roundMoney(79039.86, haler)).toBe("79039.86");
    expect(roundMoney(75174.2, haler)).toBe("75174.2");
    expect(roundMoney(24570, haler)).toBe("24570");
    expect(roundMoney(0, haler)).toBe("0");
  });

  it("half-up rounds the half away from zero; half-even to even", () => {
    expect(roundMoney("1.005", haler)).toBe("1.01");
    expect(roundMoney("1.015", haler)).toBe("1.02");
    expect(roundMoney("1.005", halerEven)).toBe("1"); // 1.00 → trimmed "1"
    expect(roundMoney("1.015", halerEven)).toBe("1.02");
    expect(roundMoney("2.5", wholeCzk)).toBe("3");
  });

  it("operates exactly on the decimal string (no float drift)", () => {
    // 0.1 + 0.2 noise never appears: the input string is taken as exact.
    expect(roundMoney("0.105", haler)).toBe("0.11");
    expect(roundMoney(0.1 + 0.2, haler)).toBe("0.3");
  });

  it("the provisional default is haléř / half-up / end-of-invoice", () => {
    expect(DEFAULT_ROUNDING_POLICY).toEqual({
      scale: 2,
      mode: "half-up",
      granularity: "end-of-invoice",
    });
  });
});

describe("addMoney / mulMoney / percentOf (exact decimal)", () => {
  it("sums money strings exactly, full precision", () => {
    expect(addMoney(["1023.744", "959.76", "1531", "12650"])).toBe("16164.504");
    expect(addMoney([])).toBe("0");
    expect(addMoney([81451.504, "129891.504"])).toBe("211343.008");
  });

  it("multiplies exactly", () => {
    expect(mulMoney("12.5", "4")).toBe("50");
    expect(mulMoney("0.1", "0.2")).toBe("0.02");
  });

  it("percentOf computes base × rate/100 exactly, unrounded", () => {
    expect(percentOf("1000", "21")).toBe("210");
    expect(percentOf("1234.55", "21")).toBe("259.2555");
    expect(percentOf("100.10", "21")).toBe("21.021");
  });
});
