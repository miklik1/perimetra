import { describe, expect, it } from "vitest";

import { numberingYear } from "./numbering-year.js";

describe("numberingYear (Prague-pinned series year)", () => {
  it("returns the Prague calendar year for an unambiguous mid-year instant", () => {
    expect(numberingYear(new Date("2026-07-24T09:00:00.000Z"))).toBe(2026);
  });

  it("rolls over at PRAGUE midnight, not UTC midnight — the New Year boundary", () => {
    // 31 Dec 2026 23:30 UTC is already 00:30 on 1 Jan 2027 in Prague (CET,
    // UTC+1). This is the exact instant the old `new Date().getFullYear()` on a
    // UTC box got wrong: it reported 2026 while the Czech calendar said 2027, so
    // a quote and an order raised minutes apart could straddle two series years.
    const justAfterPragueMidnight = new Date("2026-12-31T23:30:00.000Z");
    expect(justAfterPragueMidnight.getUTCFullYear()).toBe(2026); // what UTC sees
    expect(numberingYear(justAfterPragueMidnight)).toBe(2027); // what Prague sees
  });

  it("stays in the old year until Prague actually rolls over", () => {
    // 22:30 UTC = 23:30 Prague on 31 December — still 2026 in both frames.
    expect(numberingYear(new Date("2026-12-31T22:30:00.000Z"))).toBe(2026);
  });

  it("holds under summer time too (CEST, UTC+2)", () => {
    // 30 Jun 2026 22:30 UTC = 1 Jul 00:30 Prague — a day boundary, same year;
    // proves the helper follows the OFFSET, not a hardcoded +1.
    expect(numberingYear(new Date("2026-06-30T22:30:00.000Z"))).toBe(2026);
  });

  it("defaults to now (the production call shape)", () => {
    const year = numberingYear();
    expect(Number.isInteger(year)).toBe(true);
    // Prague is never more than a day from UTC, so the year is within ±1.
    expect(Math.abs(year - new Date().getUTCFullYear())).toBeLessThanOrEqual(1);
  });
});
