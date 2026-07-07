/**
 * Výplet fill-spacing regression lock (ADR 0098 — CAR-69).
 *
 * Pins the Excel `Kalkulace` slat-placement math (J20 = fillPitch, H20 =
 * fillOffset1) for ALL SEVEN cantilever fill types. The expected values here are
 * HAND-DERIVED from the Excel FORMULA (openpyxl-extracted from
 * `~/gates/reference_files_unlocked/2026-PC_Samonosna_brana_FINAL_PC-do 4,5m.xlsx`,
 * formulas not cached values), NOT copied from engine output — so this is a real
 * external anchor, not a tautology. The proof the derivation is faithful: the
 * anchor fill `planka_100_2d` reproduces the workbook's OWN VZOR cells
 * (J20 = 118, H20 = 13), which validates the transcription for the other six.
 *
 * The slat COUNT (`floor(hProfileLength / min_spacing)`) is golden-locked by the
 * delta-0 corpus; this file locks where the counted slats SIT. It is presentation
 * off the same derivation (I4) — BOM and price are untouched (delta-0 still
 * `81451.5`), which `sliding-gate.delta0.test.ts` proves.
 *
 * Excel chain (`Kalkulace`; hProfileLength = F32 = postA − 115 = clear_height − 295):
 *   gaps      = count − 1                                          (I20)
 *   rawPitch  = floor((hProfileLength − end1 − end2) / gaps)       (J20 inner ROUNDDOWN)
 *   pitch     = disable_max ? rawPitch : min(rawPitch, max_space)  (J20 Vypnout-max branch)
 *   remainder = hProfileLength − gaps·pitch − end1 − end2
 *   offset1   = end1 + roundUp(remainder / 2)                      (H20; ROUNDUP = ceil)
 *   slat i, at.y = ground_elevation + 90 + offset1 + (i mod count)·pitch
 */
import { describe, expect, it } from "vitest";

import { deriveInstance, deriveSite } from "@repo/engine";
import type { ConfigInput } from "@repo/engine";
import type { Catalog, Site } from "@repo/model";
import { buildScene } from "@repo/renderers";

import { catalogV1 } from "./catalog/catalog-v1.js";
import { regressionPrices } from "./golden/sliding-gate.js";
import { slidingGateV1 } from "./releases/sliding-gate.js";

interface Spacing {
  count: number;
  gaps: number;
  rawPitch: number;
  pitch: number;
  remainder: number;
  offset1: number;
}

/**
 * The seven fills at the SHARED canonical config (4.0 m × 1.5 m, 3-panel, 35° →
 * hProfileLength = 1205, the delta-0 golden geometry). Fixing the height isolates
 * every difference below to the fill's own Excel `Výplet` attrs. `disableMax`
 * mirrors the Excel `Vypnout max.?` column — TRUE for the 2D planks (spread to a
 * wide pitch), FALSE for the 3D lamellas (capped tight → the overlap look).
 * Each `expected` is hand-computed from the chain above; `planka_100_2d` equals
 * the Excel VZOR (pitch 118 / offset1 13).
 */
const CANONICAL: { fill: string; label: string; disableMax: boolean; expected: Spacing }[] = [
  {
    fill: "lamela_113_3d",
    label: "Lamela 113 3D",
    disableMax: false,
    // end1 43 end2 64 min 90 max 104 → raw floor(1098/12)=91 ≤ 104 (uncapped)
    expected: { count: 13, gaps: 12, rawPitch: 91, pitch: 91, remainder: 6, offset1: 46 },
  },
  {
    fill: "lamela_120_3d",
    label: "Lamela 120 3D",
    disableMax: false,
    // end1 24 end2 90 min 90 max 113 → raw floor(1091/12)=90 ≤ 113
    expected: { count: 13, gaps: 12, rawPitch: 90, pitch: 90, remainder: 11, offset1: 30 },
  },
  {
    fill: "planka_120_3d",
    label: "PLAŇKA 120 3D",
    disableMax: false,
    // end1 31 end2 92 min 105 max 122 → raw floor(1082/10)=108 ≤ 122
    expected: { count: 11, gaps: 10, rawPitch: 108, pitch: 108, remainder: 2, offset1: 32 },
  },
  {
    fill: "lamela_113_2d",
    label: "Lamela 113 2D",
    disableMax: true,
    // end1 48 end2 65 min 95 (max 180, disabled) → raw floor(1092/11)=99
    expected: { count: 12, gaps: 11, rawPitch: 99, pitch: 99, remainder: 3, offset1: 50 },
  },
  {
    fill: "planka_120_2d",
    label: "PLAŇKA 120 2D",
    disableMax: true,
    // end1 30 end2 90 min 121 (max 180, disabled) → raw floor(1085/8)=135
    expected: { count: 9, gaps: 8, rawPitch: 135, pitch: 135, remainder: 5, offset1: 33 },
  },
  {
    fill: "planka_100_3d",
    label: "PLAŇKA 100 3D",
    disableMax: false,
    // end1 26 end2 77 min 88 max 102 → raw floor(1102/12)=91 ≤ 102
    expected: { count: 13, gaps: 12, rawPitch: 91, pitch: 91, remainder: 10, offset1: 31 },
  },
  {
    fill: "planka_100_2d",
    label: "PLAŇKA 100 2D (Excel VZOR: J20=118, H20=13)",
    disableMax: true,
    // end1 10 end2 10 min 101 (max 120, disabled) → raw floor(1185/10)=118
    expected: { count: 11, gaps: 10, rawPitch: 118, pitch: 118, remainder: 5, offset1: 13 },
  },
];

const canonicalConfig = (fill: string): ConfigInput => ({
  opening_width_mm: 4000,
  clear_height_mm: 1500,
  suspension_angle: 35,
  panel_count: 3,
  fill_type_id: fill,
  opening_direction: "left",
  include_motor: true,
  include_installation: true,
  manufacturing_hours: 18,
});

describe("sliding-gate@1 Výplet spacing — Excel Kalkulace J20/H20 (ADR 0098)", () => {
  for (const { fill, label, expected } of CANONICAL) {
    describe(label, () => {
      const result = deriveInstance(
        slidingGateV1,
        canonicalConfig(fill),
        regressionPrices,
        catalogV1,
      );

      it("derives valid (no error issue)", () => {
        expect(result.isValid).toBe(true);
        expect(result.issues.filter((i) => i.severity === "error")).toHaveLength(0);
      });

      it("shares hProfileLength = 1205 (isolates spacing to the fill attrs)", () => {
        expect(result.derived.hProfileLength).toBe(1205);
      });

      it("pins the Excel Kalkulace spacing chain (fillPitch/fillOffset1)", () => {
        expect({
          count: result.derived.fillCount,
          gaps: result.derived.fillGaps,
          rawPitch: result.derived.fillRawPitch,
          pitch: result.derived.fillPitch,
          remainder: result.derived.fillRemainder,
          offset1: result.derived.fillOffset1,
        }).toEqual(expected);
      });
    });
  }
});

// --- Physical placement: the derived pitch/offset actually reach the slats' at.y ---

const PREVIEW = "preview";
const previewSite: Site = {
  id: "spacing-golden",
  terrain: [],
  placements: [{ instanceId: PREVIEW, pose: { origin_mm: { x: 0, y: 0 } } }],
  connections: [],
};

/** The distinct slat rows (unique local at.y), sorted low→high. Multiple panels
 *  stack slats at the SAME y (`i mod count`), so the distinct set has `count`
 *  rows: the first at ground+90+offset1, each next +pitch. */
function fillSlatRows(fill: string): number[] {
  const catalogs: ReadonlyMap<string, Catalog> = new Map([[slidingGateV1.id, catalogV1]]);
  const result = deriveSite(
    previewSite,
    [{ instanceId: PREVIEW, release: slidingGateV1, input: canonicalConfig(fill) }],
    regressionPrices,
    catalogs,
  );
  if (!result.isValid) throw new Error(`${fill} must derive valid`);
  const scene = buildScene(previewSite, result);
  const ys = scene.instances[0]!.pieces.filter((p) => p.id.includes("/fill.material/piece[")).map(
    (p) => p.at[1],
  );
  return [...new Set(ys)].sort((a, b) => a - b);
}

describe("sliding-gate@1 Výplet slat positions (at.y = ground+90+offset1 + i·pitch)", () => {
  for (const { fill, label, expected } of CANONICAL) {
    it(`${label}: ${expected.count} rows from 90+offset1, stepping by pitch`, () => {
      const rows = fillSlatRows(fill);
      expect(rows).toHaveLength(expected.count);
      expect(rows[0]).toBe(90 + expected.offset1); // ground_elevation = 0
      expect(rows[1]! - rows[0]!).toBe(expected.pitch);
      // The whole stack fits under the h-profile top (offset from the far end ≥ 0).
      const topGap = 1205 - (rows[rows.length - 1]! - 90);
      expect(topGap).toBeGreaterThanOrEqual(0);
    });
  }
});

// --- The max_spacing cap: prove the `min(raw, max)` branch (disable_max) BINDS ---
// At the canonical 1.5 m height no 3D fill's rawPitch exceeds its cap, so shrink
// to the shortest in-domain gate (clear_height 800 → hProfileLength 505) where
// PLAŇKA 120 3D's raw pitch (127) overshoots its 122 cap. Its 2D twin (cap
// disabled) spreads uncapped — the visible "3D tight vs 2D spread" divergence.

describe("sliding-gate@1 Výplet — max_spacing cap binds (disable_max_spacing)", () => {
  const shortGate = (fill: string): ConfigInput => ({
    ...canonicalConfig(fill),
    clear_height_mm: 800,
  });

  it("PLAŇKA 120 3D caps rawPitch 127 → pitch 122 (max_spacing binds)", () => {
    const r = deriveInstance(
      slidingGateV1,
      shortGate("planka_120_3d"),
      regressionPrices,
      catalogV1,
    );
    expect(r.isValid).toBe(true);
    expect(r.derived.hProfileLength).toBe(505);
    expect(r.derived.fillRawPitch).toBe(127);
    expect(r.derived.fillPitch).toBe(122); // min(127, 122)
    expect(r.derived.fillOffset1).toBe(39);
  });

  it("PLAŇKA 120 2D (cap disabled) does NOT cap — spreads to rawPitch 128", () => {
    const r = deriveInstance(
      slidingGateV1,
      shortGate("planka_120_2d"),
      regressionPrices,
      catalogV1,
    );
    expect(r.isValid).toBe(true);
    expect(r.derived.hProfileLength).toBe(505);
    expect(r.derived.fillRawPitch).toBe(128);
    expect(r.derived.fillPitch).toBe(128); // uncapped: pitch === rawPitch
    expect(r.derived.fillOffset1).toBe(31);
  });
});
