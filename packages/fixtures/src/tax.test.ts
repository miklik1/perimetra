/**
 * CZ-tax golden corpus harness (ADR 0080) — proves the structured tax layer on
 * the REAL engine output. The standard / §92e cases derive the actual golden
 * site net from the engine (not a literal) and feed it through the pure
 * `deriveTaxBreakdown`, so a drift in either the money re-baseline (ADR 0081) or
 * the tax computation fails here. Mixed-rate + rounding edges exercise the
 * structure on synthetic bases.
 */
import { describe, expect, it } from "vitest";

import { deriveSite, type SiteInstance } from "@repo/engine";
import { DEFAULT_ROUNDING_POLICY, deriveTaxBreakdown, type Catalog } from "@repo/model";

import { catalogV2 } from "./catalog/catalog-v2.js";
import { siteFenceConfig, siteGateConfig, sitePrices, steppedSite } from "./golden/site.js";
import { SITE_NET, taxGolden } from "./golden/tax.js";
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

describe("CZ-tax golden corpus — on the real derived site net", () => {
  const siteNet = deriveSite(steppedSite, instances(), sitePrices, cats).money.total;

  it("the engine's re-baselined site net IS the corpus base (ties the slices)", () => {
    expect(siteNet).toBe(SITE_NET);
  });

  it("1. standard 21 % — net → VAT (haléř) → gross", () => {
    const b = deriveTaxBreakdown(
      [{ ratePct: "21", netBase: siteNet }],
      "standard_vat",
      DEFAULT_ROUNDING_POLICY,
      "CZK",
    );
    expect(b).toEqual(taxGolden.standard.expected);
  });

  it("2. §92e reverse charge — NO VAT line, gross == net, mandatory legend", () => {
    const b = deriveTaxBreakdown(
      [{ ratePct: "21", netBase: siteNet }],
      "reverse_charge_92e",
      DEFAULT_ROUNDING_POLICY,
      "CZK",
    );
    expect(b).toEqual(taxGolden.reverseCharge.expected);
    expect(b.vatTotal).toBe("0");
    expect(b.legend).toBeTruthy();
  });

  it("3. mixed rate — per-rate VAT, lines descending", () => {
    const b = deriveTaxBreakdown(
      taxGolden.mixed.base,
      "standard_vat",
      DEFAULT_ROUNDING_POLICY,
      "CZK",
    );
    expect(b).toEqual(taxGolden.mixed.expected);
  });

  it("4. rounding edges — VAT rounds to haléř (half-up)", () => {
    const b = deriveTaxBreakdown(
      taxGolden.roundingEdges.base,
      "standard_vat",
      DEFAULT_ROUNDING_POLICY,
      "CZK",
    );
    expect(b).toEqual(taxGolden.roundingEdges.expected);
  });

  it("is deterministic — the breakdown re-derives byte-identically (I3)", () => {
    const once = deriveTaxBreakdown(
      [{ ratePct: "21", netBase: siteNet }],
      "standard_vat",
      DEFAULT_ROUNDING_POLICY,
      "CZK",
    );
    const again = deriveTaxBreakdown(
      [{ ratePct: "21", netBase: siteNet }],
      "standard_vat",
      DEFAULT_ROUNDING_POLICY,
      "CZK",
    );
    expect(JSON.stringify(again)).toBe(JSON.stringify(once));
  });
});
