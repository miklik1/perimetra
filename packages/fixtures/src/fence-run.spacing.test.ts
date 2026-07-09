/**
 * `fence-run@1` Výplet fill-spacing + priced-golden lock (CAR-32, ADR 0098).
 *
 * The member chain, fill spacing, every BOM line and the priced total are
 * HAND-DERIVED from the Excel FORMULAS (`2026-PC_Ploty_FINAL_PC.xlsx`,
 * `Kalkulace` + `Výplet`, formulas not cached values) — NOT copied from engine
 * output. The proof the transcription is faithful: LAMELA 113 3D at a 2000 mm
 * bay reproduces the workbook's own Pole-1 cells (K32 = 21, F26 = 1987, J33 =
 * 94, F27 = 1930).
 *
 * The fence spacing shares the ADR-0098 chain (count → gaps → rawPitch → pitch
 * capped unless disable_max) but feeds the RAW clear height (the fence divides by
 * it directly; the h-profil carrier length `fillZoneHeight` is the chain OUTPUT,
 * Excel F26 = konce1 + gaps·pitch + konce2), with the `Ploty` Výplet numbers.
 * Note: the `Ploty` max-pitch caps (max. rozteč 142–180) are high, so no in-
 * domain 3D fill hits the cap — the 2D/3D divergence here is the carrier (h-25
 * vs h-50) + the fill's own end-offsets, not a bound cap.
 */
import { describe, expect, it } from "vitest";

import { deriveInstance, deriveSite } from "@repo/engine";
import type { ConfigInput } from "@repo/engine";
import type { Catalog, Site } from "@repo/model";
import { validateRelease } from "@repo/model";
import { buildScene } from "@repo/renderers";

import { catalogV2 } from "./catalog/catalog-v2.js";
import { fenceGoldens, fencePrices } from "./golden/fence-run.js";
import { fenceRunV1 } from "./releases/fence-run.js";

describe("fence-run@1 — publishes clean (I2 gate)", () => {
  it("validateRelease returns no defects", () => {
    expect(validateRelease(fenceRunV1, catalogV2)).toEqual([]);
  });
});

// --- The seven Výplet fills at the canonical bay (2000 × 2000) ---------------
// Fixing the bay isolates every difference to the fill's own `Ploty` Výplet
// attrs. `end1` (min. vzd. od konce 1) drives the first-lamella offset.

interface Spacing {
  count: number;
  gaps: number;
  rawPitch: number;
  pitch: number;
  zoneHeight: number;
  bottomMargin: number;
  end1: number;
}

const CANONICAL: { fill: string; label: string; expected: Spacing }[] = [
  {
    fill: "lamela_113_3d",
    label: "Lamela 113 3D (Excel Pole-1: K32=21, F26=1987, J33=94)",
    // end1 43 end2 64 min 90 → count floor(2000/90)−1=21, raw floor(1893/20)=94 ≤ 160
    expected: {
      count: 21,
      gaps: 20,
      rawPitch: 94,
      pitch: 94,
      zoneHeight: 1987,
      bottomMargin: 6,
      end1: 43,
    },
  },
  {
    fill: "lamela_120_3d",
    label: "Lamela 120 3D",
    // end1 24 end2 90 min 90 → count 21, raw floor(1886/20)=94 ≤ 160
    expected: {
      count: 21,
      gaps: 20,
      rawPitch: 94,
      pitch: 94,
      zoneHeight: 1994,
      bottomMargin: 3,
      end1: 24,
    },
  },
  {
    fill: "planka_120_3d",
    label: "PLAŇKA 120 3D",
    // end1 31 end2 92 min 105 → count floor(2000/105)−1=18, raw floor(1877/17)=110 ≤ 170
    expected: {
      count: 18,
      gaps: 17,
      rawPitch: 110,
      pitch: 110,
      zoneHeight: 1993,
      bottomMargin: 3,
      end1: 31,
    },
  },
  {
    fill: "lamela_113_2d",
    label: "Lamela 113 2D",
    // end1 48 end2 65 min 95 → count floor(2000/95)−1=20, raw floor(1887/19)=99 (cap disabled)
    expected: {
      count: 20,
      gaps: 19,
      rawPitch: 99,
      pitch: 99,
      zoneHeight: 1994,
      bottomMargin: 3,
      end1: 48,
    },
  },
  {
    fill: "planka_120_2d",
    label: "PLAŇKA 120 2D",
    // end1 30 end2 90 min 121 → count floor(2000/121)−1=15, raw floor(1880/14)=134 (cap disabled)
    expected: {
      count: 15,
      gaps: 14,
      rawPitch: 134,
      pitch: 134,
      zoneHeight: 1996,
      bottomMargin: 2,
      end1: 30,
    },
  },
  {
    fill: "planka_100_3d",
    label: "PLAŇKA 100 3D",
    // end1 26 end2 77 min 88 → count floor(2000/88)−1=21, raw floor(1897/20)=94 ≤ 142
    expected: {
      count: 21,
      gaps: 20,
      rawPitch: 94,
      pitch: 94,
      zoneHeight: 1983,
      bottomMargin: 8,
      end1: 26,
    },
  },
  {
    fill: "planka_100_2d",
    label: "PLAŇKA 100 2D",
    // end1 25 end2 75 min 101 → count floor(2000/101)−1=18, raw floor(1900/17)=111 (cap disabled)
    expected: {
      count: 18,
      gaps: 17,
      rawPitch: 111,
      pitch: 111,
      zoneHeight: 1987,
      bottomMargin: 6,
      end1: 25,
    },
  },
];

const canonicalConfig = (fill: string): ConfigInput => ({
  run_length_mm: 8000,
  clear_height_mm: 2000,
  fill_type_id: fill,
  frame_material: "alu",
  include_installation: true,
});

describe("fence-run@1 Výplet spacing — Excel Ploty Kalkulace (K32/J33/F26)", () => {
  for (const { fill, label, expected } of CANONICAL) {
    describe(label, () => {
      const result = deriveInstance(fenceRunV1, canonicalConfig(fill), fencePrices, catalogV2);

      it("derives valid (no error issue)", () => {
        expect(result.isValid).toBe(true);
        expect(result.issues.filter((i) => i.severity === "error")).toHaveLength(0);
      });

      it("pins the Excel spacing chain (count/pitch/fillZoneHeight)", () => {
        expect({
          count: result.derived.fillCount,
          gaps: result.derived.fillGaps,
          rawPitch: result.derived.fillRawPitch,
          pitch: result.derived.fillPitch,
          zoneHeight: result.derived.fillZoneHeight,
          bottomMargin: result.derived.fillBottomMargin,
        }).toEqual({
          count: expected.count,
          gaps: expected.gaps,
          rawPitch: expected.rawPitch,
          pitch: expected.pitch,
          zoneHeight: expected.zoneHeight,
          bottomMargin: expected.bottomMargin,
        });
      });
    });
  }
});

// --- Physical placement: the derived spacing actually reaches the scene ------

const PREVIEW = "preview";
const previewSite: Site = {
  id: "fence-spacing-golden",
  terrain: [],
  placements: [{ instanceId: PREVIEW, pose: { origin_mm: { x: 0, y: 0 } } }],
  connections: [],
};

/** Distinct lamella rows (unique local at.y), low→high. Every bay stacks its
 *  lamellas at the SAME y (`i mod fillCount`), so the distinct set has `count`
 *  rows: first at fillBottomMargin + end1, each next + pitch. */
function fillRows(fill: string): number[] {
  const catalogs: ReadonlyMap<string, Catalog> = new Map([[fenceRunV1.id, catalogV2]]);
  const result = deriveSite(
    previewSite,
    [{ instanceId: PREVIEW, release: fenceRunV1, input: canonicalConfig(fill) }],
    fencePrices,
    catalogs,
  );
  if (!result.isValid) throw new Error(`${fill} must derive valid`);
  const scene = buildScene(previewSite, result);
  const ys = scene.instances[0]!.pieces.filter((p) => p.id.includes("/fill.material/piece[")).map(
    (p) => p.at[1],
  );
  return [...new Set(ys)].sort((a, b) => a - b);
}

describe("fence-run@1 Výplet lamella positions (at.y = bottomMargin + end1 + i·pitch)", () => {
  for (const { fill, label, expected } of CANONICAL) {
    it(`${label}: ${expected.count} rows from bottomMargin+end1, stepping by pitch`, () => {
      const rows = fillRows(fill);
      expect(rows).toHaveLength(expected.count);
      expect(rows[0]).toBe(expected.bottomMargin + expected.end1); // ground_elevation = 0
      expect(rows[1]! - rows[0]!).toBe(expected.pitch);
      // The whole stack fits inside the fill zone (last lamella ≤ zone top).
      const zoneTop = expected.bottomMargin + expected.zoneHeight;
      expect(rows[rows.length - 1]!).toBeLessThanOrEqual(zoneTop);
    });
  }
});

// --- The priced golden: byte-true to the Excel Ploty BOM + total -------------

describe("fence-run@1 — priced golden (Excel Ploty BOM byte-true)", () => {
  for (const gc of fenceGoldens) {
    describe(gc.name, () => {
      const result = deriveInstance(fenceRunV1, gc.config, gc.prices, catalogV2);

      it("derives valid", () => {
        expect(result.isValid).toBe(true);
        expect(result.issues.filter((i) => i.severity === "error")).toHaveLength(0);
      });

      it("pins the Excel per-bay dimensions", () => {
        for (const [key, value] of Object.entries(gc.expectedDimensions)) {
          expect(result.derived[key]).toBe(value);
        }
      });

      it("pins the fill spacing", () => {
        expect(result.derived.fillCount).toBe(gc.expectedFill.count);
        expect(result.derived.fillPitch).toBe(gc.expectedFill.pitch);
        expect(result.derived.fillZoneHeight).toBe(gc.expectedFill.zoneHeight);
        expect(result.derived.lamellaLength).toBe(gc.expectedFill.lamellaLength);
      });

      it("pins the priced category totals + total (I10 money strings)", () => {
        expect(result.money).toEqual(gc.expectedMoney);
      });
    });
  }
});
