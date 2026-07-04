import { isDeepStrictEqual } from "node:util";
import { describe, expect, it } from "vitest";

import { siteCosts, sitePrices } from "@repo/fixtures";

import {
  blankComponentRow,
  buildCostTableData,
  buildPriceTableData,
  buildPublishPayload,
  componentRowsFromLayers,
  DEFAULT_PRICE_TABLE_FORM_VALUES,
  findDuplicateComponentCodes,
  hydrateFromIsland,
  parseIslandJson,
  serializeIsland,
  type PriceTableFormValues,
} from "./price-table-form-model";

/** The seed corpus (`packages/fixtures/src/golden/site.ts`) run through the
 *  structured form model — the load-bearing acceptance for CAR-15: entering
 *  the SAME data the old textarea path accepted must produce a byte-equivalent
 *  body, never a lossy re-encoding. */
function formValuesFromFixtures(): PriceTableFormValues {
  return {
    ...DEFAULT_PRICE_TABLE_FORM_VALUES,
    effectiveFrom: "2026-01-01T00:00",
    version: String(sitePrices.version),
    components: componentRowsFromLayers(sitePrices, siteCosts),
    manufacturingRate: String(sitePrices.manufacturing.rate),
    manufacturingMultiplier: String(sitePrices.manufacturing.multiplier),
    installation: String(sitePrices.installation),
    hasCost: true,
    costManufacturingRate: String(siteCosts.manufacturing.rate),
    costManufacturingMultiplier: String(siteCosts.manufacturing.multiplier),
    costInstallation: String(siteCosts.installation),
  };
}

describe("price-table form model — round-trip golden (CAR-15)", () => {
  it("rebuilds the golden sitePrices table byte-for-byte from structured rows", () => {
    const values = formValuesFromFixtures();
    const table = buildPriceTableData(values);
    expect(isDeepStrictEqual(table, sitePrices)).toBe(true);
  });

  it("rebuilds the golden siteCosts table byte-for-byte from structured rows", () => {
    const values = formValuesFromFixtures();
    const cost = buildCostTableData(values);
    expect(isDeepStrictEqual(cost, siteCosts)).toBe(true);
  });

  it("the full publish payload carries both bodies byte-for-byte", () => {
    const values = formValuesFromFixtures();
    const payload = buildPublishPayload(values);
    expect(isDeepStrictEqual(payload.table, sitePrices)).toBe(true);
    expect(isDeepStrictEqual(payload.cost, siteCosts)).toBe(true);
  });

  it("omits the cost body entirely when hasCost is false, regardless of row cost values", () => {
    const values = { ...formValuesFromFixtures(), hasCost: false };
    const payload = buildPublishPayload(values);
    expect(payload.cost).toBeUndefined();
  });

  it("round-trips through the bulk-JSON island (serialize -> parse -> hydrate)", () => {
    const values = formValuesFromFixtures();
    const json = serializeIsland(values);
    const parsed = parseIslandJson(json);
    const hydrated = hydrateFromIsland(parsed);
    const rehydratedValues: PriceTableFormValues = { ...values, ...hydrated };
    expect(isDeepStrictEqual(buildPriceTableData(rehydratedValues), sitePrices)).toBe(true);
    expect(isDeepStrictEqual(buildCostTableData(rehydratedValues), siteCosts)).toBe(true);
  });
});

describe("componentRowsFromLayers", () => {
  it("unions codes present in either layer and blanks the missing side", () => {
    const rows = componentRowsFromLayers(
      {
        version: 1,
        components: { a: 1 },
        manufacturing: { rate: 1, multiplier: 1 },
        installation: 0,
      },
      { components: { b: 2 }, manufacturing: { rate: 1, multiplier: 1 }, installation: 0 },
    );
    expect(rows).toEqual(
      expect.arrayContaining([
        { code: "a", price: "1", cost: "" },
        { code: "b", price: "", cost: "2" },
      ]),
    );
    expect(rows).toHaveLength(2);
  });
});

describe("blankComponentRow", () => {
  it("is an empty, code-less row — dropped from the payload until filled in", () => {
    const values: PriceTableFormValues = {
      ...DEFAULT_PRICE_TABLE_FORM_VALUES,
      components: [blankComponentRow(), { code: "a", price: "10", cost: "" }],
      manufacturingRate: "0",
      manufacturingMultiplier: "0",
      installation: "0",
    };
    expect(buildPriceTableData(values).components).toEqual({ a: 10 });
  });
});

describe("findDuplicateComponentCodes", () => {
  it("reports codes repeated across rows (trimmed), ignoring blank codes", () => {
    const dupes = findDuplicateComponentCodes([
      { code: "a", price: "1", cost: "" },
      { code: " a ", price: "2", cost: "" },
      { code: "", price: "3", cost: "" },
      { code: "b", price: "4", cost: "" },
    ]);
    expect(dupes).toEqual(["a"]);
  });

  it("returns an empty array when every code is unique", () => {
    expect(
      findDuplicateComponentCodes([
        { code: "a", price: "1", cost: "" },
        { code: "b", price: "2", cost: "" },
      ]),
    ).toEqual([]);
  });
});

describe("parseIslandJson", () => {
  it("throws SyntaxError on malformed JSON — never leaks to the caller unhandled", () => {
    expect(() => parseIslandJson("{not json")).toThrow();
  });

  it("throws a ZodError when the shape doesn't match PriceTableData/CostTableData", () => {
    expect(() => parseIslandJson(JSON.stringify({ table: { version: "nope" } }))).toThrow();
  });

  it("accepts a table-only payload (no cost layer)", () => {
    const payload = parseIslandJson(
      JSON.stringify({
        table: {
          version: 1,
          components: { a: 1 },
          manufacturing: { rate: 1, multiplier: 1 },
          installation: 0,
        },
      }),
    );
    expect(payload.cost).toBeUndefined();
    expect(hydrateFromIsland(payload).hasCost).toBe(false);
  });
});
