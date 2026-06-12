/**
 * Delta-0 proving harness (CORE_SPEC §10 step 1) — the end-to-end exercise of
 * @repo/model + @repo/engine on the authored `sliding-gate@1` release against
 * the ported MVP goldens.
 *
 *   I1 (determinism) — re-running the same (release, config, prices) yields a
 *                      byte-identical result.
 *   I2 (delta-0)     — every expected dimension, fill count, and the grand
 *                      total reproduce the Excel-anchored MVP values exactly.
 *
 * A red test here means the release cannot be published.
 */
import { describe, expect, it } from "vitest";

import { deriveInstance } from "@repo/engine";

import { slidingGateGoldens } from "./golden/sliding-gate";
import { slidingGateV1 } from "./releases/sliding-gate";

describe("sliding-gate@1 — delta-0 vs MVP goldens (I1/I2)", () => {
  for (const golden of slidingGateGoldens) {
    describe(golden.name, () => {
      const result = deriveInstance(slidingGateV1, golden.config, golden.prices);

      it("derives without an error issue", () => {
        expect(result.isValid).toBe(true);
        expect(result.issues.filter((i) => i.severity === "error")).toHaveLength(0);
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

      it("is deterministic — re-derivation is byte-identical (I1)", () => {
        const again = deriveInstance(slidingGateV1, golden.config, golden.prices);
        expect(JSON.stringify(again)).toBe(JSON.stringify(result));
      });
    });
  }
});

describe("sliding-gate@1 — invariants", () => {
  const golden = slidingGateGoldens[0]!;

  it("surfaces a typed error, not a silent zero, on an out-of-range input (I5)", () => {
    const result = deriveInstance(
      slidingGateV1,
      { ...golden.config, opening_width_mm: 12000 },
      golden.prices,
    );
    expect(result.isValid).toBe(false);
    expect(result.issues.map((i) => i.key)).toContain("sliding.opening_width.range");
    expect(result.totals.total).toBe(0);
  });

  it("resolves the fill component code from the selected option", () => {
    const result = deriveInstance(slidingGateV1, golden.config, golden.prices);
    const fill = result.parts.find((p) => p.path === "fill.material");
    expect(fill?.componentCode).toBe("planka_100");
  });

  it("drops the motor line when include_motor is false", () => {
    const result = deriveInstance(
      slidingGateV1,
      { ...golden.config, include_motor: false },
      golden.prices,
    );
    expect(result.parts.find((p) => p.path === "drive.motor")).toBeUndefined();
  });
});
