/**
 * Nabídka renderer golden (ADR 0085) — the pure-data commercial document off the
 * REAL derived golden site + the CZ-tax breakdown (ADR 0080). Proves the L layer
 * is deterministic (I3) and carries the §92e legend structurally.
 */
import { describe, expect, it } from "vitest";

import { deriveSite, type SiteInstance } from "@repo/engine";
import { DEFAULT_ROUNDING_POLICY, deriveTaxBreakdown, type Catalog } from "@repo/model";
import { buildNabidka, type NabidkaCustomer, type NabidkaSupplier } from "@repo/renderers";

import { catalogV2 } from "./catalog/catalog-v2.js";
import { siteFenceConfig, siteGateConfig, sitePrices, steppedSite } from "./golden/site.js";
import { fenceRunV1 } from "./releases/fence-run.js";
import { slidingGateV1 } from "./releases/sliding-gate.js";

const cats = new Map<string, Catalog>([
  ["sliding-gate@1", catalogV2],
  ["fence-run@1", catalogV2],
]);
const instances = (): SiteInstance[] => [
  { instanceId: "gate", release: slidingGateV1, input: siteGateConfig },
  { instanceId: "fenceA", release: fenceRunV1, input: siteFenceConfig },
  { instanceId: "fenceB", release: fenceRunV1, input: siteFenceConfig },
];

const customer: NabidkaCustomer = {
  name: "Bartek Vrata s.r.o.",
  ico: "27074358",
  dic: "CZ27074358",
  city: "Brno",
};

const supplier: NabidkaSupplier = {
  name: "Perimetra Vrata s.r.o.",
  ico: "01234567",
  dic: "CZ01234567",
  addressLine: "Tovární 5",
  city: "Olomouc",
  postalCode: "77900",
  bankAccount: "123456789/0800",
  registrationNote: "Zapsáno v OR vedeném Krajským soudem v Ostravě, oddíl C.",
};

describe("buildNabidka — the pure-data commercial document", () => {
  const result = deriveSite(steppedSite, instances(), sitePrices, cats);
  const standardTax = deriveTaxBreakdown(
    [{ ratePct: "21", netBase: result.money.total }],
    "standard_vat",
    DEFAULT_ROUNDING_POLICY,
    "CZK",
  );

  it("carries the header, line items, category subtotals + standard-VAT totals", () => {
    const doc = buildNabidka(steppedSite, result, {
      documentNumber: "2026/0001",
      supplier,
      customer,
      tax: standardTax,
    });
    expect(doc.documentNumber).toBe("2026/0001");
    // The supplier (dodavatel) block is carried through as pure data (ADR 0088).
    expect(doc.supplier?.name).toBe("Perimetra Vrata s.r.o.");
    expect(doc.supplier?.dic).toBe("CZ01234567");
    expect(doc.supplier?.bankAccount).toBe("123456789/0800");
    expect(doc.customer?.dic).toBe("CZ27074358");
    expect(doc.currency).toBe("CZK");
    expect(doc.instanceCount).toBe(3);
    expect(doc.lines.length).toBe(result.bom.length);
    expect(doc.categories).toEqual([
      { key: "material", total: "69183" },
      { key: "accessory", total: "38820.5" },
      { key: "manufacturing", total: "16220" },
      { key: "installation", total: "10500" },
    ]);
    // Standard VAT: net 134723.5 → VAT 28291.94 → gross 163015.44; no legend.
    expect(doc.netTotal).toBe("134723.5");
    expect(doc.vatTotal).toBe("28291.94");
    expect(doc.grossTotal).toBe("163015.44");
    expect(doc.legend).toBeUndefined();
  });

  it("§92e renders a no-VAT-line document carrying the mandatory legend", () => {
    const reverseTax = deriveTaxBreakdown(
      [{ ratePct: "21", netBase: result.money.total }],
      "reverse_charge_92e",
      DEFAULT_ROUNDING_POLICY,
      "CZK",
    );
    const doc = buildNabidka(steppedSite, result, {
      documentNumber: "2026/0002",
      customer,
      tax: reverseTax,
    });
    expect(doc.vatTotal).toBe("0");
    expect(doc.grossTotal).toBe("134723.5");
    expect(doc.legend).toMatch(/§ ?92e/);
  });

  it("is deterministic — the document re-derives byte-identically (I3)", () => {
    const build = () =>
      buildNabidka(steppedSite, deriveSite(steppedSite, instances(), sitePrices, cats), {
        documentNumber: "2026/0001",
        supplier,
        customer,
        tax: standardTax,
      });
    expect(JSON.stringify(build())).toBe(JSON.stringify(build()));
  });
});
