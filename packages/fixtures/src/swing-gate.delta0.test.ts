/**
 * Delta-0 proving harness for `swing-gate@1` (CORE_SPEC §10) — the end-to-end
 * exercise of @repo/model + @repo/engine on the authored double-leaf swing gate
 * (Brány Křídlové) release + `catalog@3` against the Excel-anchored golden.
 *
 *   I1 (determinism) — re-running the same (release, config, prices, catalog)
 *                      yields a byte-identical result.
 *   I2 (delta-0)     — every expected dimension, the plank count, and the grand
 *                      total reproduce the Excel VZOR (U34 = 55 843.4) exactly.
 *   I3 (stamps)      — the result records which release + catalog + price-table
 *                      versions it was derived under.
 *
 * A red test here means the release cannot be published.
 */
import { describe, expect, it } from "vitest";

import { checkFixtures, deriveInstance } from "@repo/engine";
import { validateRelease } from "@repo/model";

import { catalogV3 } from "./catalog/catalog-v3.js";
import { planka_120_3d_vzor, swingGateGoldens } from "./golden/swing-gate.js";
import { swingGateV1 } from "./releases/swing-gate.js";

describe("swing-gate@1 — publish gate (validateRelease)", () => {
  it("has zero defects against catalog@3", () => {
    expect(validateRelease(swingGateV1, catalogV3)).toEqual([]);
  });
});

// The publish gate's I2 EXECUTION half (price-free): the release's embedded
// fixtures must reproduce their expected derived dims against the catalog it is
// published WITH — its parts must resolve there.
describe("swing-gate@1 — I2 fixture execution (checkFixtures)", () => {
  it("reproduces its fixtures against catalog@3", () => {
    const checks = checkFixtures(swingGateV1, catalogV3);
    expect(checks.length).toBeGreaterThan(0);
    for (const c of checks) {
      expect(c.mismatches, c.name).toEqual([]);
      expect(c.issues, c.name).toEqual([]);
      expect(c.ok).toBe(true);
    }
  });
});

describe("swing-gate@1 — delta-0 vs the Excel VZOR golden (I1/I2)", () => {
  for (const golden of swingGateGoldens) {
    describe(golden.name, () => {
      const result = deriveInstance(swingGateV1, golden.config, golden.prices, catalogV3);

      it("derives without an error issue", () => {
        expect(result.isValid).toBe(true);
        expect(result.issues.filter((i) => i.severity === "error")).toHaveLength(0);
      });

      it("stamps the release, catalog, and price-table versions (I3)", () => {
        expect(result.stamps).toEqual({
          releaseId: "swing-gate@1",
          catalogVersion: 3,
          priceTableVersion: 1,
          overrideIds: [],
        });
      });

      it("dimensions match the Excel chain", () => {
        for (const [key, expected] of Object.entries(golden.expectedDimensions)) {
          expect(result.derived[key], key).toBeCloseTo(expected, 6);
        }
      });

      it("plank count and piece length match", () => {
        expect(result.derived.plankCount).toBe(golden.expectedFill.count);
        expect(result.derived.plankLength).toBeCloseTo(golden.expectedFill.fillLength, 6);
      });

      it("grand total equals the Excel U34 exactly (delta-0)", () => {
        expect(result.totals.total).toBeCloseTo(golden.expectedTotalPrice, 2);
      });

      it("money boundary is the delta-0 value as a decimal string (I10)", () => {
        expect(result.money.total).toBe(String(golden.expectedTotalPrice));
      });

      it("is deterministic — re-derivation is byte-identical (I1)", () => {
        const again = deriveInstance(swingGateV1, golden.config, golden.prices, catalogV3);
        expect(JSON.stringify(again)).toBe(JSON.stringify(result));
      });
    });
  }
});

describe("swing-gate@1 — invariants", () => {
  const golden = planka_120_3d_vzor;

  it("rejects an out-of-domain input at the gate with a typed issue (I5/I7)", () => {
    const result = deriveInstance(
      swingGateV1,
      { ...golden.config, opening_width_mm: 12000 },
      golden.prices,
      catalogV3,
    );
    expect(result.isValid).toBe(false);
    expect(result.issues).toEqual([
      {
        key: "engine.input.above_max",
        severity: "error",
        scope: "instance",
        params: { key: "opening_width_mm", max: 6000, value: 12000 },
      },
    ]);
    expect(result.totals.total).toBe(0);
  });

  it("resolves the fill component through the catalog from the selected option", () => {
    const result = deriveInstance(swingGateV1, golden.config, golden.prices, catalogV3);
    expect(result.parts.find((p) => p.path === "fill.material")?.componentCode).toBe("planka_120");
  });

  it("resolves the 100×100 hinge post via the gate-post role (catalog@3)", () => {
    const result = deriveInstance(swingGateV1, golden.config, golden.prices, catalogV3);
    expect(result.parts.find((p) => p.path === "frame.post")?.componentCode).toBe("sloup_100");
  });

  it("drops the installation line when include_installation is false", () => {
    const result = deriveInstance(
      swingGateV1,
      { ...golden.config, include_installation: false },
      golden.prices,
      catalogV3,
    );
    expect(result.parts.find((p) => p.path === "labor.installation")).toBeUndefined();
  });
});
