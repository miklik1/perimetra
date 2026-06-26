import { describe, expect, it } from "vitest";

import { DEFAULT_ROUNDING_POLICY, type RoundingPolicy } from "./money.js";
import {
  deriveTaxBreakdown,
  resolveTaxMode,
  REVERSE_CHARGE_92E_LEGEND_CS,
  type RateBase,
} from "./tax.js";

const haler: RoundingPolicy = DEFAULT_ROUNDING_POLICY;

describe("resolveTaxMode (§92e ruleset — PROVISIONAL, ADR 0080)", () => {
  it("§92e reverse charge iff both parties are CZ VAT payers AND construction/assembly", () => {
    expect(
      resolveTaxMode({
        supplierVatPayer: true,
        customerVatPayer: true,
        constructionAssembly: true,
      }),
    ).toBe("reverse_charge_92e");
  });

  it("standard VAT when any condition is absent", () => {
    expect(
      resolveTaxMode({
        supplierVatPayer: true,
        customerVatPayer: true,
        constructionAssembly: false,
      }),
    ).toBe("standard_vat");
    expect(
      resolveTaxMode({
        supplierVatPayer: true,
        customerVatPayer: false,
        constructionAssembly: true,
      }),
    ).toBe("standard_vat");
    expect(
      resolveTaxMode({
        supplierVatPayer: false,
        customerVatPayer: true,
        constructionAssembly: true,
      }),
    ).toBe("standard_vat");
  });
});

describe("deriveTaxBreakdown — standard VAT (21 %)", () => {
  const bases: RateBase[] = [{ ratePct: "21", netBase: "129891.5" }];
  const b = deriveTaxBreakdown(bases, "standard_vat", haler, "CZK");

  it("one rate line: net → VAT (rounded) → gross", () => {
    expect(b.lines).toEqual([
      { ratePct: "21", netBase: "129891.5", vatAmount: "27277.22", gross: "157168.72" },
    ]);
  });

  it("totals and no legend for standard VAT", () => {
    expect(b.netTotal).toBe("129891.5");
    expect(b.vatTotal).toBe("27277.22");
    expect(b.grossTotal).toBe("157168.72");
    expect(b.legend).toBeUndefined();
    expect(b.mode).toBe("standard_vat");
    expect(b.currency).toBe("CZK");
    expect(b.rounding).toEqual(haler);
  });
});

describe("deriveTaxBreakdown — §92e reverse charge (no VAT line + legend)", () => {
  const b = deriveTaxBreakdown(
    [{ ratePct: "21", netBase: "129891.5" }],
    "reverse_charge_92e",
    haler,
    "CZK",
  );

  it("carries NO VAT (vatAmount/vatTotal are 0, gross == net)", () => {
    expect(b.lines).toEqual([
      { ratePct: "21", netBase: "129891.5", vatAmount: "0", gross: "129891.5" },
    ]);
    expect(b.vatTotal).toBe("0");
    expect(b.netTotal).toBe("129891.5");
    expect(b.grossTotal).toBe("129891.5");
  });

  it("carries the mandatory legend", () => {
    expect(b.mode).toBe("reverse_charge_92e");
    expect(b.legend).toBe(REVERSE_CHARGE_92E_LEGEND_CS);
  });
});

describe("deriveTaxBreakdown — mixed rate (21 % + 12 %)", () => {
  const b = deriveTaxBreakdown(
    [
      { ratePct: "12", netBase: "10000" },
      { ratePct: "21", netBase: "100000" },
    ],
    "standard_vat",
    haler,
    "CZK",
  );

  it("sorts rate lines descending and computes VAT per rate", () => {
    expect(b.lines).toEqual([
      { ratePct: "21", netBase: "100000", vatAmount: "21000", gross: "121000" },
      { ratePct: "12", netBase: "10000", vatAmount: "1200", gross: "11200" },
    ]);
    expect(b.netTotal).toBe("110000");
    expect(b.vatTotal).toBe("22200");
    expect(b.grossTotal).toBe("132200");
  });

  it("collapses duplicate rate groups before computing", () => {
    const merged = deriveTaxBreakdown(
      [
        { ratePct: "21", netBase: "1000" },
        { ratePct: "21", netBase: "500" },
      ],
      "standard_vat",
      haler,
      "CZK",
    );
    expect(merged.lines).toEqual([
      { ratePct: "21", netBase: "1500", vatAmount: "315", gross: "1815" },
    ]);
  });
});

describe("deriveTaxBreakdown — VAT rounding edges (haléř, half-up)", () => {
  it("rounds the VAT amount, not the base", () => {
    // 100.10 × 21% = 21.021 → 21.02 ; 1234.55 × 21% = 259.2555 → 259.26
    const b = deriveTaxBreakdown(
      [{ ratePct: "21", netBase: "100.1" }],
      "standard_vat",
      haler,
      "CZK",
    );
    expect(b.lines[0]).toEqual({
      ratePct: "21",
      netBase: "100.1",
      vatAmount: "21.02",
      gross: "121.12",
    });
    const b2 = deriveTaxBreakdown(
      [{ ratePct: "21", netBase: "1234.55" }],
      "standard_vat",
      haler,
      "CZK",
    );
    expect(b2.lines[0]!.vatAmount).toBe("259.26");
  });
});
