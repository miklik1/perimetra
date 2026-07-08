/**
 * Golden corpus for `branka@1` (CORE_SPEC I2). The GEOMETRY is the Excel anchor
 * (`2026-PC_Branky_FINAL_PC.xlsx`, `Kalkulace`, 1xSP): member lengths + the
 * Výplet spacing chain are byte-true to the workbook formulas. Prices are the
 * Excel `Kalkulace` sell values (Sloupek L 427/m, h-profil 200/m, Výplň 250/m,
 * Výroba 850/h, Montáž 2650) — the priced total is regression-locked (no 1xSP
 * total cell exists in the workbook; the VZOR is the sDP variant), NOT an Excel
 * total anchor. Hardware sets (pant/kování/rám-šroub/zámek) land with CAR-34.
 */
import type { ConfigInput, PriceTable } from "@repo/engine";

export interface BrankaGoldenCase {
  name: string;
  anchored: boolean;
  config: ConfigInput;
  prices: PriceTable;
  /** Excel-anchored member + spacing dimensions (byte-true to the formulas). */
  expectedDimensions: Record<string, number>;
  expectedFill: { count: number; pitch: number; offset1: number; slatLength: number };
}

/** Branka `Kalkulace` sell prices (cena/metr / cena/ks). Výroba rate 850 (T30),
 *  Montáž 2650 (S31). The multiplier is the blank-hours per-size default. */
export const brankaPrices: PriceTable = {
  version: 1,
  components: {
    sloupek_l_50: 427,
    h_profile_50: 200,
    planka_100: 250,
    lamela_113: 217,
    lamela_120: 275,
    planka_120: 275,
    fill_connector: 4.5,
  },
  manufacturing: { rate: 850, multiplier: 10 },
  installation: 2650,
};

/** The Excel geometry anchor: 1xSP, PLAŇKA 100 2D, 1000 × 1500. */
export const planka_100_2d_1xsp: BrankaGoldenCase = {
  name: "PLAŇKA 100 2D · 1xSP · 1000×1500 (Excel Branky geometry)",
  anchored: true,
  config: {
    clear_width_mm: 1000,
    clear_height_mm: 1500,
    fill_type_id: "planka_100_2d",
    frame_material: "alu",
    opening_direction: "left",
    include_electrolock: false,
    include_installation: false,
    manufacturing_hours: 10,
  },
  prices: brankaPrices,
  expectedDimensions: {
    stileLength: 1400,
    railLength: 910,
    latchPostLength: 1470,
    fillSlatLength: 780,
    hProfileLength: 1294,
  },
  expectedFill: { count: 11, pitch: 127, offset1: 12, slatLength: 780 },
};

export const brankaGoldens: BrankaGoldenCase[] = [planka_100_2d_1xsp];
