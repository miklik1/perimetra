/**
 * Golden corpus for `swing-gate@1` (CORE_SPEC I2) — the double-leaf swing gate
 * (Brány Křídlové). The delta-0 lock: the generic engine cannot "publish" the
 * release unless it reproduces every expected value here byte-identically.
 *
 *   planka_120_3d_vzor — THE Excel anchor (`Kalkulace` U34 = 55 843.4, the VZOR
 *                        two-leaf / divided / on-posts sample; every BOM line is
 *                        hand-derived from the workbook FORMULAS, not cached
 *                        cells — see SWING_GATE_ASSEMBLY_MODEL.md).
 *
 * Every value is transcribed by hand from the Excel formulas (per the repo's
 * Excel-ground-truth convention), then the engine is proven to reproduce them —
 * never the reverse. `prices` mirrors the FIL `Kalkulace` sell prices (S-column);
 * the engine injects it as the `price.*` cascade layer (CORE_SPEC §4).
 */
import type { ConfigInput, PriceTable } from "@repo/engine";

export interface SwingGoldenCase {
  name: string;
  anchored: boolean;
  config: ConfigInput;
  prices: PriceTable;
  expectedDimensions: Record<string, number>;
  /** plankCount (total, both leaves) + plankLength (Excel F23). */
  expectedFill: { count: number; fillLength: number };
  expectedTotalPrice: number;
}

const sharedPrices = {
  version: 1,
  // Výroba 850 CZK/h (Excel S32), 20 h default (T32); Montáž 10 500 (S33).
  manufacturing: { rate: 850, multiplier: 20 },
  installation: 10500,
};

/** The alu component sell prices the swing gate resolves (Excel `Kalkulace`
 *  S-column). The four fill prices serve all seven infill types (the 2D/3D
 *  variant of one profile shares a catalog component + price). `sloup_100`
 *  (1080), `fill_connector` (4.95) and the five hardware SKUs are the swing
 *  family's own values. */
const aluComponents = {
  sloupek_l_50: 427,
  sloupek_t_50: 495,
  h_profile_50: 200,
  sloup_100: 1080,
  planka_100: 250,
  lamela_113: 217,
  lamela_120: 275,
  planka_120: 275,
  limit_s: 420,
  zastrc: 400,
  frame_kit_bolted: 1700,
  kovani_klika_koule: 1700,
  sada_pant: 675,
  fill_connector: 4.95,
};

/** All-fills alu price table — shared by the anchor case and the ADR-0098
 *  spacing lock (`swing-gate.spacing.test`), which sweeps every fill type. */
export const swingPrices: PriceTable = {
  components: { ...aluComponents },
  ...sharedPrices,
};

/**
 * THE Excel anchor: the VZOR sample — PLAŇKA 120 3D infill, two equal leaves
 * (KSŠ), a horizontal dividing rail (sDP), on 100×100 posts (BnS), 3.0 m clear
 * width × 1.5 m clear height. `Kalkulace` U34 = 55 843.4.
 *
 * BOM (each line hand-derived from the workbook; sums to 55 843.4):
 *   Sloupek L 50×50  11 m × 427  = 4 697   (A 3×1400 + B 4×1465 = 10 060 mm)
 *   Sloupek T 50×50   5 m × 495  = 2 475   (C 1×1470 + D 2×1365 = 4 200 mm)
 *   h-profil 50       5 m × 200  = 1 000   (4×823 + 4×415 = 4 952 mm)
 *   Výplň            25 m × 275  = 6 875   (18 × 1335 = 24 030 mm)
 *   Sloup 100×100     4 m × 1080 = 4 320   (2 × 1510 = 3 020 mm)
 *   Limit S           1  × 420   =   420
 *   Zástrč            1  × 400   =   400
 *   Sada k rámu       2  × 1700  = 3 400
 *   Kování            1  × 1700  = 1 700
 *   Sada pant         4  × 675   = 2 700
 *   Spojovák výplně  72  × 4.95  =   356.4
 *   Výroba           20 h × 850  = 17 000
 *   Montáž            1  × 10500 = 10 500
 */
export const planka_120_3d_vzor: SwingGoldenCase = {
  name: "PLAŇKA 120 3D · two-leaf divided on-posts · 3.0 m (Excel U34 delta-0)",
  anchored: true,
  config: {
    opening_width_mm: 3000,
    clear_height_mm: 1500,
    fill_type_id: "planka_120_3d",
    ground_elevation_mm: 0,
    manufacturing_hours: 20, // Excel T32 (hand-entered)
    include_installation: true,
  },
  prices: swingPrices,
  expectedDimensions: {
    frameInnerHeight: 1400,
    leafWidth: 1465,
    centerStileHeight: 1470,
    dividerRailLength: 1365,
    plankLength: 1335,
    postHeight: 1510,
    usableInfillHeight: 1238,
    upperSectionHeight: 823,
    lowerSectionHeight: 415,
    upperFillCount: 6,
    upperFillPitch: 122,
    upperFillOffset1: 76,
    lowerFillCount: 3,
    lowerFillPitch: 122,
    lowerFillOffset1: 55,
    plankCountPerLeaf: 9,
    plankCount: 18,
    lProfileTotalMm: 10060,
    tProfileTotalMm: 4200,
    hProfileTotalMm: 4952,
    fillTotalMm: 24030,
    postTotalMm: 3020,
    spojovakCount: 72,
  },
  expectedFill: { count: 18, fillLength: 1335 },
  expectedTotalPrice: 55843.4,
};

export const swingGateGoldens: SwingGoldenCase[] = [planka_120_3d_vzor];
