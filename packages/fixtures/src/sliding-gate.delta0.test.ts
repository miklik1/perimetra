/**
 * Delta-0 proving harness (CORE_SPEC §10 steps 1–2) — the end-to-end exercise
 * of @repo/model + @repo/engine on the authored `sliding-gate@1` release and
 * `catalog@1` against the ported MVP goldens.
 *
 *   I1 (determinism) — re-running the same (release, config, prices, catalog)
 *                      yields a byte-identical result.
 *   I2 (delta-0)     — every expected dimension, fill count, and the grand
 *                      total reproduce the Excel-anchored MVP values exactly.
 *   I3 (stamps)      — the result records exactly which release + catalog
 *                      versions it was derived under.
 *   step 2           — the same recipe yields aluminum or steel through
 *                      role-based catalog resolution (multi-material), and the
 *                      release passes the validateRelease publish gate.
 *
 * A red test here means the release cannot be published.
 */
import { describe, expect, it } from "vitest";

import { deriveInstance } from "@repo/engine";
import { validateRelease } from "@repo/model";

import { catalogV1 } from "./catalog/catalog-v1";
import { slidingGateGoldens, steel_frame_3panel } from "./golden/sliding-gate";
import { slidingGateV1 } from "./releases/sliding-gate";

describe("sliding-gate@1 — publish gate (validateRelease)", () => {
  it("has zero defects against catalog@1", () => {
    expect(validateRelease(slidingGateV1, catalogV1)).toEqual([]);
  });
});

describe("sliding-gate@1 — delta-0 vs MVP goldens (I1/I2)", () => {
  for (const golden of slidingGateGoldens) {
    describe(golden.name, () => {
      const result = deriveInstance(slidingGateV1, golden.config, golden.prices, catalogV1);

      it("derives without an error issue", () => {
        expect(result.isValid).toBe(true);
        expect(result.issues.filter((i) => i.severity === "error")).toHaveLength(0);
      });

      it("stamps the release, catalog, and price-table versions (I3)", () => {
        expect(result.stamps).toEqual({
          releaseId: "sliding-gate@1",
          catalogVersion: 1,
          priceTableVersion: 1,
          overrideIds: [],
        });
      });

      it("dimensions match the MVP chain", () => {
        for (const [key, expected] of Object.entries(golden.expectedDimensions)) {
          expect(result.derived[key], key).toBeCloseTo(expected, 6);
        }
      });

      it("fill count and piece length match", () => {
        expect(result.derived.fillCount).toBe(golden.expectedFill.count);
        expect(result.derived.fillPieceLength).toBeCloseTo(golden.expectedFill.fillLength, 6);
      });

      it("grand total equals the golden exactly (delta-0)", () => {
        expect(result.totals.total).toBeCloseTo(golden.expectedTotalPrice, 2);
      });

      it("money boundary is the delta-0 value as a decimal string (I10)", () => {
        // String-exact: the boundary representation IS the golden, not a
        // re-rounded cousin of it (ADR 0045/0048).
        expect(result.money.total).toBe(String(golden.expectedTotalPrice));
      });

      it("is deterministic — re-derivation is byte-identical (I1)", () => {
        const again = deriveInstance(slidingGateV1, golden.config, golden.prices, catalogV1);
        expect(JSON.stringify(again)).toBe(JSON.stringify(result));
      });
    });
  }
});

describe("sliding-gate@1 — multi-material resolution (step 2)", () => {
  const golden = slidingGateGoldens[0]!;
  const alu = deriveInstance(slidingGateV1, golden.config, golden.prices, catalogV1);
  const steel = deriveInstance(
    slidingGateV1,
    steel_frame_3panel.config,
    steel_frame_3panel.prices,
    catalogV1,
  );

  it("the SAME recipe resolves alu or steel SKUs by the material parameter", () => {
    const code = (result: typeof alu, path: string) =>
      result.parts.find((p) => p.path === path)?.componentCode;
    for (const [path, aluCode] of [
      ["frame.lprofile", "sloupek_l_50"],
      ["frame.tpost", "sloupek_t_50"],
      ["frame.hprofile", "h_profile_50"],
      ["fill.material", "planka_100"],
    ] as const) {
      expect(code(alu, path)).toBe(aluCode);
      expect(code(steel, path)).toBe(`${aluCode}_steel`);
    }
  });

  it("geometry is material-independent; only material lines reprice", () => {
    expect(steel.derived).toEqual(alu.derived);
    expect(steel.totals.accessory).toBe(alu.totals.accessory);
    expect(steel.totals.manufacturing).toBe(alu.totals.manufacturing);
    expect(steel.totals.installation).toBe(alu.totals.installation);
    expect(steel.totals.material).toBeLessThan(alu.totals.material);
  });

  it("resolves the ENZO standard set below the 6700 threshold (price-table truth)", () => {
    const enzo = alu.parts.find((p) => p.path === "rail.set[standard]");
    expect(enzo?.componentCode).toBe("rail_set_enzo");
    expect(enzo?.totalPrice).toBe(12650); // priced from the table, no CZK in the release
    expect(alu.parts.find((p) => p.path === "rail.set[long]")).toBeUndefined();
  });
});

describe("sliding-gate@1 — invariants", () => {
  const golden = slidingGateGoldens[0]!;

  it("rejects an out-of-domain input at the gate with a typed issue (I5/I7)", () => {
    const result = deriveInstance(
      slidingGateV1,
      { ...golden.config, opening_width_mm: 12000 },
      golden.prices,
      catalogV1,
    );
    expect(result.isValid).toBe(false);
    expect(result.issues).toEqual([
      {
        key: "engine.input.above_max",
        severity: "error",
        scope: "instance",
        params: { key: "opening_width_mm", max: 8000, value: 12000 },
      },
    ]);
    expect(result.totals.total).toBe(0);
  });

  it("resolves the fill component through the catalog from the selected option", () => {
    const result = deriveInstance(slidingGateV1, golden.config, golden.prices, catalogV1);
    const fill = result.parts.find((p) => p.path === "fill.material");
    expect(fill?.componentCode).toBe("planka_100");
  });

  it("drops the motor line when include_motor is false", () => {
    const result = deriveInstance(
      slidingGateV1,
      { ...golden.config, include_motor: false },
      golden.prices,
      catalogV1,
    );
    expect(result.parts.find((p) => p.path === "drive.motor")).toBeUndefined();
  });
});
