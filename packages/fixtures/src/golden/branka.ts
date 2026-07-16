/**
 * Golden corpus for `branka@1` (CORE_SPEC I2). The GEOMETRY is the Excel anchor
 * (`2026-PC_Branky_FINAL_PC.xlsx`, `Kalkulace`, 1xSP): member lengths + the
 * Výplet spacing chain are byte-true to the workbook formulas. Prices are the
 * Excel `Kalkulace` sell values: material (Sloupek L 427/m, h-profil 200/m,
 * Výplň 250/m), hardware (Sada rám šroub 1350, Sada kování 1695, Sada pant 675,
 * Elektro-zámek 680), and labour (Výroba 850/h, Montáž 2650). The 1xSP grand
 * total (`expectedTotalPrice` 18 734.0, no electrolock/installation) is
 * regression-locked: every LINE price is Excel-anchored, but the workbook has no
 * 1xSP total cell (its VZOR is the sDP variant, U32 = 19 078.5), so the total is
 * a self-consistency lock, NOT an Excel total anchor. The fill connector
 * (Excel S29 = SUM(E23)) is 0 for the undivided 1xSP — a divided-panel splice,
 * absent here (see the release parts note).
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
  /** 1xSP grand total (CZK) — line prices Excel-anchored, total regression-locked. */
  expectedTotalPrice: number;
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
    // Hardware (Branky Kalkulace S24/S26–S28) — priced per set / per piece.
    sada_ram_sroub: 1350,
    sada_kovani: 1695,
    sada_pant: 675,
    elektro_zamek: 680,
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
  // Sloupek L 7 m·427 = 2989 · h-profil 3 m·200 = 600 · Výplň 9 m·250 = 2250 ·
  // Sada rám šroub 1·1350 · Sada kování 1·1695 · Sada pant 2·675 = 1350 ·
  // Výroba 10 h·850 = 8500.  NO Spojovák (Excel S29 = SUM(E23) = 0 for the
  // undivided 1xSP); electrolock/montáž off.
  expectedTotalPrice: 18734,
};

export const brankaGoldens: BrankaGoldenCase[] = [planka_100_2d_1xsp];
