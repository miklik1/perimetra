/**
 * Delta-0 proving harness for `branka@1` (CORE_SPEC §10) — the end-to-end
 * exercise of @repo/model + @repo/engine on the authored pedestrian gate
 * (Branka, 1xSP) release + `catalog@4` against the Excel-anchored golden.
 *
 *   I1 (determinism) — re-running the same (release, config, prices, catalog)
 *                      yields a byte-identical result.
 *   I2 (line prices) — every member length + the Výplet spacing chain reproduces
 *                      the Excel `Branky` Kalkulace (1xSP) formulas; every BOM
 *                      LINE price is an Excel `Kalkulace` sell value.
 *   I3 (stamps)      — the result records which release + catalog + price-table
 *                      versions it was derived under (catalog@4).
 *
 * The GRAND TOTAL (18 783.5) is a self-consistency regression lock, NOT an Excel
 * anchor: the workbook has no 1xSP total cell (its VZOR is the sDP variant,
 * U32 = 19 078.5 — the named breadth follow-on). A red test here means the
 * release cannot be published.
 */
import { describe, expect, it } from "vitest";

import { checkFixtures, deriveInstance } from "@repo/engine";
import { validateRelease } from "@repo/model";

import { catalogV4 } from "./catalog/catalog-v4.js";
import { brankaGoldens, planka_100_2d_1xsp } from "./golden/branka.js";
import { brankaV1 } from "./releases/branka.js";

describe("branka@1 — publish gate (validateRelease)", () => {
  it("has zero defects against catalog@4", () => {
    expect(validateRelease(brankaV1, catalogV4)).toEqual([]);
  });
});

// The publish gate's I2 EXECUTION half (price-free): the release's embedded
// fixtures must reproduce their expected derived dims against the catalog it is
// published WITH — its parts (incl. the new hardware roles) must resolve there.
describe("branka@1 — I2 fixture execution (checkFixtures)", () => {
  it("reproduces its fixtures against catalog@4", () => {
    const checks = checkFixtures(brankaV1, catalogV4);
    expect(checks.length).toBeGreaterThan(0);
    for (const c of checks) {
      expect(c.mismatches, c.name).toEqual([]);
      expect(c.issues, c.name).toEqual([]);
      expect(c.ok).toBe(true);
    }
  });
});

describe("branka@1 — delta-0 vs the Excel golden (I1/I2/I3)", () => {
  for (const golden of brankaGoldens) {
    describe(golden.name, () => {
      const result = deriveInstance(brankaV1, golden.config, golden.prices, catalogV4);

      it("derives without an error issue", () => {
        expect(result.isValid).toBe(true);
        expect(result.issues.filter((i) => i.severity === "error")).toHaveLength(0);
      });

      it("stamps the release, catalog, and price-table versions (I3)", () => {
        expect(result.stamps).toEqual({
          releaseId: "branka@1",
          catalogVersion: 4,
          priceTableVersion: 1,
          overrideIds: [],
        });
      });

      it("dimensions match the Excel chain", () => {
        for (const [key, expected] of Object.entries(golden.expectedDimensions)) {
          expect(result.derived[key], key).toBeCloseTo(expected, 6);
        }
      });

      it("fill count / pitch / offset / slat length match the Excel Výplet", () => {
        expect(result.derived.fillCount).toBe(golden.expectedFill.count);
        expect(result.derived.fillPitch).toBeCloseTo(golden.expectedFill.pitch, 6);
        expect(result.derived.fillOffset1).toBeCloseTo(golden.expectedFill.offset1, 6);
        expect(result.derived.fillSlatLength).toBeCloseTo(golden.expectedFill.slatLength, 6);
      });

      it("grand total is the regression-locked line-anchored sum (delta-0)", () => {
        expect(result.totals.total).toBeCloseTo(golden.expectedTotalPrice, 2);
      });

      it("money boundary is the total as a decimal string (I10)", () => {
        expect(result.money.total).toBe(String(golden.expectedTotalPrice));
      });

      it("is deterministic — re-derivation is byte-identical (I1)", () => {
        const again = deriveInstance(brankaV1, golden.config, golden.prices, catalogV4);
        expect(JSON.stringify(again)).toBe(JSON.stringify(result));
      });
    });
  }
});

describe("branka@1 — hardware BOM (Excel Kalkulace accessory lines P24/P26–P28)", () => {
  const golden = planka_100_2d_1xsp;

  it("resolves each hardware set to its catalog@4 component", () => {
    const result = deriveInstance(brankaV1, golden.config, golden.prices, catalogV4);
    const code = (path: string) => result.parts.find((p) => p.path === path)?.componentCode;
    expect(code("hardware.frame_bolt")).toBe("sada_ram_sroub");
    expect(code("hardware.lockset")).toBe("sada_kovani");
    expect(code("hardware.hinge")).toBe("sada_pant"); // shared SKU with the swing gate
  });

  it("omits the electrolock line by default, adds it (680) when opted in", () => {
    const off = deriveInstance(brankaV1, golden.config, golden.prices, catalogV4);
    expect(off.parts.find((p) => p.path === "hardware.electrolock")).toBeUndefined();

    const on = deriveInstance(
      brankaV1,
      { ...golden.config, include_electrolock: true },
      golden.prices,
      catalogV4,
    );
    expect(on.parts.find((p) => p.path === "hardware.electrolock")?.componentCode).toBe(
      "elektro_zamek",
    );
    // A single 680 line → the grand total steps by exactly 680.
    expect(on.totals.total).toBeCloseTo(golden.expectedTotalPrice + 680, 2);
  });

  it("charges NO fill-connector line for the undivided 1xSP (Excel S29 = SUM(E23) = 0)", () => {
    // The `Spojovák výplně` splice tracks member E (the divided-panel fill),
    // empty for 1xSP — so the BOM must carry no connector line here. A cached-
    // sDP-state misread over-charged 49.5 CZK until the CAR-34 review caught it.
    const result = deriveInstance(brankaV1, golden.config, golden.prices, catalogV4);
    expect(result.parts.find((p) => p.path === "fill.connectors")).toBeUndefined();
  });
});
