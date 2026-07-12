/**
 * Výplet fill-spacing regression lock for `swing-gate@1` (ADR 0098).
 *
 * The swing gate's sDP dividing rail splits each leaf into an UPPER (Horní) and
 * LOWER (Spodní) infill section, so the Excel `Kalkulace` slat-placement chain
 * runs TWICE — cells K19/I20/J20/H20 for the upper band, K21/I22/J22/H22 for the
 * lower. Every expected value here is HAND-DERIVED from those FORMULAS (openpyxl,
 * formulas not cached cells), NOT copied from engine output — a real external
 * anchor, not a tautology. The proof the transcription is faithful: the VZOR fill
 * `planka_120_3d` reproduces the workbook's OWN VZOR cells (upper J20 = 122 /
 * H20 = 76, lower J22 = 122 / H22 = 55), which validates the other six fills.
 *
 * The slat COUNT is golden-locked by the delta-0 corpus (plankCount 18); this
 * file locks where the counted slats SIT. It is presentation off the same
 * derivation (I4) — BOM and price are untouched (delta-0 still 55843.4).
 *
 * Chain (per section, height H = upper 823 / lower 415 at the canonical config):
 *   count     = floor(H / min_spacing) − O   (O = 1 upper / 0 lower, Excel O37/O38)
 *   gaps      = max(count − 1, 1)
 *   rawPitch  = floor((H − end1 − end2) / gaps)
 *   pitch     = disable_max ? rawPitch : min(rawPitch, max_spacing)
 *   remainder = H − gaps·pitch − end1 − end2
 *   offset1   = end1 + roundUp(remainder / 2)
 */
import { describe, expect, it } from "vitest";

import { deriveInstance, deriveSite } from "@repo/engine";
import type { ConfigInput } from "@repo/engine";
import type { Catalog, Site } from "@repo/model";
import { buildScene } from "@repo/renderers";

import { catalogV3 } from "./catalog/catalog-v3.js";
import { swingPrices } from "./golden/swing-gate.js";
import { swingGateV1 } from "./releases/swing-gate.js";

interface Spacing {
  count: number;
  gaps: number;
  rawPitch: number;
  pitch: number;
  remainder: number;
  offset1: number;
}

/**
 * The seven fills at the SHARED canonical config (the VZOR geometry: 3.0 m ×
 * 1.5 m → upperSectionHeight 823, lowerSectionHeight 415). Fixing the height
 * isolates every difference to the fill's own Excel `Výplet` attrs. `disableMax`
 * mirrors the `Vypnout max.?` column — TRUE for the 2D planks (spread wide),
 * FALSE for the 3D lamellas (capped tight). `planka_120_3d` equals the Excel
 * VZOR cells exactly (upper 122/76, lower 122/55).
 */
const CANONICAL: {
  fill: string;
  label: string;
  disableMax: boolean;
  upper: Spacing;
  lower: Spacing;
}[] = [
  {
    fill: "lamela_113_3d",
    label: "Lamela 113 3D",
    disableMax: false,
    // end1 43 end2 64 min 90 max 104
    upper: { count: 8, gaps: 7, rawPitch: 102, pitch: 102, remainder: 2, offset1: 44 },
    lower: { count: 4, gaps: 3, rawPitch: 102, pitch: 102, remainder: 2, offset1: 44 },
  },
  {
    fill: "lamela_120_3d",
    label: "Lamela 120 3D",
    disableMax: false,
    // end1 24 end2 90 min 90 max 113
    upper: { count: 8, gaps: 7, rawPitch: 101, pitch: 101, remainder: 2, offset1: 25 },
    lower: { count: 4, gaps: 3, rawPitch: 100, pitch: 100, remainder: 1, offset1: 25 },
  },
  {
    fill: "planka_120_3d",
    label: "PLAŇKA 120 3D (Excel VZOR: upper J20=122/H20=76, lower J22=122/H22=55)",
    disableMax: false,
    // end1 31 end2 92 min 105 max 122 → both sections cap (raw > 122)
    upper: { count: 6, gaps: 5, rawPitch: 140, pitch: 122, remainder: 90, offset1: 76 },
    lower: { count: 3, gaps: 2, rawPitch: 146, pitch: 122, remainder: 48, offset1: 55 },
  },
  {
    fill: "lamela_113_2d",
    label: "Lamela 113 2D",
    disableMax: true,
    // end1 48 end2 65 min 95 (max 180, disabled)
    upper: { count: 7, gaps: 6, rawPitch: 118, pitch: 118, remainder: 2, offset1: 49 },
    lower: { count: 4, gaps: 3, rawPitch: 100, pitch: 100, remainder: 2, offset1: 49 },
  },
  {
    fill: "planka_120_2d",
    label: "PLAŇKA 120 2D",
    disableMax: true,
    // end1 30 end2 90 min 121 (max 180, disabled)
    upper: { count: 5, gaps: 4, rawPitch: 175, pitch: 175, remainder: 3, offset1: 32 },
    lower: { count: 3, gaps: 2, rawPitch: 147, pitch: 147, remainder: 1, offset1: 31 },
  },
  {
    fill: "planka_100_3d",
    label: "PLAŇKA 100 3D",
    disableMax: false,
    // end1 26 end2 77 min 88 max 102
    upper: { count: 8, gaps: 7, rawPitch: 102, pitch: 102, remainder: 6, offset1: 29 },
    lower: { count: 4, gaps: 3, rawPitch: 104, pitch: 102, remainder: 6, offset1: 29 },
  },
  {
    fill: "planka_100_2d",
    label: "PLAŇKA 100 2D",
    disableMax: true,
    // end1 10 end2 10 min 101 (max 120, disabled)
    upper: { count: 7, gaps: 6, rawPitch: 133, pitch: 133, remainder: 5, offset1: 13 },
    lower: { count: 4, gaps: 3, rawPitch: 131, pitch: 131, remainder: 2, offset1: 11 },
  },
];

const canonicalConfig = (fill: string): ConfigInput => ({
  opening_width_mm: 3000,
  clear_height_mm: 1500,
  fill_type_id: fill,
  ground_elevation_mm: 0,
});

describe("swing-gate@1 Výplet spacing — Excel Kalkulace upper/lower chains (ADR 0098)", () => {
  for (const { fill, label, upper, lower } of CANONICAL) {
    describe(label, () => {
      const result = deriveInstance(swingGateV1, canonicalConfig(fill), swingPrices, catalogV3);

      it("derives valid (no error issue)", () => {
        expect(result.isValid).toBe(true);
        expect(result.issues.filter((i) => i.severity === "error")).toHaveLength(0);
      });

      it("shares the section heights 823 / 415 (isolates spacing to the fill attrs)", () => {
        expect(result.derived.upperSectionHeight).toBe(823);
        expect(result.derived.lowerSectionHeight).toBe(415);
      });

      it("pins the UPPER (Horní) chain (K19/I20/J20/H20)", () => {
        expect({
          count: result.derived.upperFillCount,
          gaps: result.derived.upperFillGaps,
          rawPitch: result.derived.upperFillRawPitch,
          pitch: result.derived.upperFillPitch,
          remainder: result.derived.upperFillRemainder,
          offset1: result.derived.upperFillOffset1,
        }).toEqual(upper);
      });

      it("pins the LOWER (Spodní) chain (K21/I22/J22/H22)", () => {
        expect({
          count: result.derived.lowerFillCount,
          gaps: result.derived.lowerFillGaps,
          rawPitch: result.derived.lowerFillRawPitch,
          pitch: result.derived.lowerFillPitch,
          remainder: result.derived.lowerFillRemainder,
          offset1: result.derived.lowerFillOffset1,
        }).toEqual(lower);
      });
    });
  }
});

// --- Physical placement: the derived pitch/offset actually reach the slats' at.y ---

const PREVIEW = "preview";
const previewSite: Site = {
  id: "swing-spacing-golden",
  terrain: [],
  placements: [{ instanceId: PREVIEW, pose: { origin_mm: { x: 0, y: 0 } } }],
  connections: [],
};

/** The distinct slat rows (unique local at.y) for one band, sorted low→high.
 *  Both leaves stack slats at the SAME y, so the distinct set has one entry per
 *  row. `band` selects the geometry key prefix (plank_upper / plank_lower). */
function fillRows(fill: string, band: "upper" | "lower"): number[] {
  const catalogs: ReadonlyMap<string, Catalog> = new Map([[swingGateV1.id, catalogV3]]);
  const result = deriveSite(
    previewSite,
    [{ instanceId: PREVIEW, release: swingGateV1, input: canonicalConfig(fill) }],
    swingPrices,
    catalogs,
  );
  if (!result.isValid) throw new Error(`${fill} must derive valid`);
  const scene = buildScene(previewSite, result);
  const ys = scene.instances[0]!.pieces.filter((p) =>
    p.id.includes(`/fill.material/plank_${band}[`),
  ).map((p) => p.at[1]);
  return [...new Set(ys)].sort((a, b) => a - b);
}

describe("swing-gate@1 Výplet slat positions (upper + lower bands step by pitch)", () => {
  for (const { fill, label, upper, lower } of CANONICAL) {
    describe(label, () => {
      const derived = deriveInstance(
        swingGateV1,
        canonicalConfig(fill),
        swingPrices,
        catalogV3,
      ).derived;

      it(`upper band: ${upper.count} rows from base+offset1, stepping by pitch`, () => {
        const rows = fillRows(fill, "upper");
        expect(rows).toHaveLength(upper.count);
        expect(rows[0]).toBe(Number(derived.upperBandBottom) + upper.offset1);
        if (rows.length > 1) expect(rows[1]! - rows[0]!).toBe(upper.pitch);
      });

      it(`lower band: ${lower.count} rows from base+offset1, stepping by pitch`, () => {
        const rows = fillRows(fill, "lower");
        expect(rows).toHaveLength(lower.count);
        expect(rows[0]).toBe(Number(derived.lowerBandBottom) + lower.offset1);
        if (rows.length > 1) expect(rows[1]! - rows[0]!).toBe(lower.pitch);
      });

      it("the upper band sits entirely above the lower band (divider separates them)", () => {
        const up = fillRows(fill, "upper");
        const lo = fillRows(fill, "lower");
        expect(lo[lo.length - 1]!).toBeLessThan(up[0]!);
      });
    });
  }
});
