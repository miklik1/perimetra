/**
 * Golden corpus for `fence-run@1` (CORE_SPEC I2). The GEOMETRY + PRICE are the
 * Excel anchor (`2026-PC_Ploty_FINAL_PC.xlsx`, `Kalkulace` + `Výplet`): member
 * lengths, the Výplet spacing chain, every BOM line quantity, and the priced
 * total are byte-true to the workbook FORMULAS (not cached values). The proof the
 * transcription is faithful: the derived per-bay chain reproduces the workbook's
 * own Pole-1 cells (K32 = 21, F26 = 1987, J33 = 94, F27 = 1930).
 *
 * Prices are the `Ploty` sell values: Sloup 100 `1080/m` (S21), h-profil `210/m`
 * (3D, E184) / `140/m` (2D, E185), fill cena/m from the Výplet H-column, caps
 * `156` (S22/S29), Krytka h-profil `5` (S28), Patka `850` (S30), Spojovák `4.95`
 * (S31), and the FLAT per-field labour Výroba `500` (S32) + Montáž `650` (S33).
 * Note the fence h-profil (210) and fill connector (4.95) differ from the gate
 * families' shared components (200 / 5) — different workbook, so a tenant with
 * one price list reconciles them; each golden is byte-true to its OWN source.
 *
 * Steel is a regression lock (the `Ploty` workbook is aluminium-only, so steel
 * carries no Excel anchor) — geometry is material-independent, only the material
 * lines reprice.
 */
import type { ConfigInput, PriceTable } from "@repo/engine";

export interface FenceGoldenCase {
  name: string;
  anchored: boolean;
  config: ConfigInput;
  prices: PriceTable;
  /** Excel-anchored per-bay member + spacing dimensions (byte-true to formulas). */
  expectedDimensions: Record<string, number>;
  expectedFill: { count: number; pitch: number; zoneHeight: number; lamellaLength: number };
  /** Category money totals as the I10 boundary strings. */
  expectedMoney: {
    material: string;
    accessory: string;
    manufacturing: string;
    installation: string;
    total: string;
  };
}

/** `Ploty` sell prices (cena/m for profiles, cena/ks for accessories, flat
 *  per-field for labour). `manufacturing.rate`/`installation` scalars are the
 *  gate families' hours-model and are UNUSED by the fence (its labour is the
 *  per-field `fence_manufacturing` / `fence_installation` components). */
export const fencePrices: PriceTable = {
  version: 1,
  components: {
    // material
    sloup_100: 1080,
    h_profile_50: 210,
    h_profile_25: 140,
    planka_100: 250,
    lamela_113: 217,
    lamela_120: 275,
    planka_120: 275,
    // accessory
    krytka_roof: 156,
    krytka_sloup_100: 156,
    krytka_h_profile: 5,
    patka_sloup: 850,
    fill_connector: 4.95,
    // labour (flat per field)
    fence_manufacturing: 500,
    fence_installation: 650,
  },
  manufacturing: { rate: 0, multiplier: 0 },
  installation: 0,
};

/** Steel prices — regression-only (NOT Excel-anchored); alu prices + steel
 *  material variants at plausible fabrication ratios. */
export const fenceSteelPrices: PriceTable = {
  version: 1,
  components: {
    ...fencePrices.components,
    sloup_100_steel: 640,
    h_profile_50_steel: 130,
    h_profile_25_steel: 90,
    lamela_113_steel: 175,
  },
  manufacturing: { rate: 0, multiplier: 0 },
  installation: 0,
};

/** THE Excel geometry + price anchor: LAMELA 113 3D, bay 2000 × 2000, 4 bays. */
export const lamela_113_3d_ploty: FenceGoldenCase = {
  name: "LAMELA 113 3D · bay 2000 × 2000 · 4 bays (Excel Ploty anchor)",
  anchored: true,
  config: {
    run_length_mm: 8000,
    clear_height_mm: 2000,
    fill_type_id: "lamela_113_3d",
    frame_material: "alu",
    include_installation: true,
  },
  prices: fencePrices,
  expectedDimensions: {
    fieldCount: 4,
    fieldWidth: 2000,
    postCount: 5,
    postLength: 2000,
    lamellaLength: 1930,
    fillZoneHeight: 1987,
    hProfileTotal: 16,
    lamellaTotal: 84,
  },
  expectedFill: { count: 21, pitch: 94, zoneHeight: 1987, lamellaLength: 1930 },
  // h-profil 32 m × 210 + Výplň 163 m × 217 + Sloup 10 m × 1080 = 52 891 material;
  // caps 5×156 + 5×156 + krytka-h 8×5 + patka 5×850 + spojovák 84×4.95 = 6 265.8;
  // Výroba 4×500 = 2 000 ; Montáž 4×650 = 2 600. Total 63 756.8.
  expectedMoney: {
    material: "52891",
    accessory: "6265.8",
    manufacturing: "2000",
    installation: "2600",
    total: "63756.8",
  },
};

/** The 2D path (h-25 carrier + disabled max-spacing): PLAŇKA 100 2D, same bay. */
export const planka_100_2d_ploty: FenceGoldenCase = {
  name: "PLAŇKA 100 2D · bay 2000 × 2000 · 4 bays (Excel Ploty, 2D/h-25 path)",
  anchored: true,
  config: {
    run_length_mm: 8000,
    clear_height_mm: 2000,
    fill_type_id: "planka_100_2d",
    frame_material: "alu",
    include_installation: true,
  },
  prices: fencePrices,
  expectedDimensions: {
    fieldCount: 4,
    fieldWidth: 2000,
    postCount: 5,
    postLength: 2000,
    lamellaLength: 1930,
    fillZoneHeight: 1987,
    hProfileTotal: 16,
    lamellaTotal: 72,
  },
  expectedFill: { count: 18, pitch: 111, zoneHeight: 1987, lamellaLength: 1930 },
  // h-profil 32 m × 140 + Výplň 139 m × 250 + Sloup 10 m × 1080 = 50 030 material;
  // caps 780 + 780 + 40 + patka 4 250 + spojovák 72×4.95 = 6 206.4 ; 2 000 ; 2 600.
  expectedMoney: {
    material: "50030",
    accessory: "6206.4",
    manufacturing: "2000",
    installation: "2600",
    total: "60836.4",
  },
};

/** Steel re-derive (regression, anchored:false): same geometry, steel material
 *  lines. Money is engine-locked (steel prices are not Excel-anchored). */
export const lamela_113_3d_steel: FenceGoldenCase = {
  name: "LAMELA 113 3D · bay 2000 × 2000 · STEEL frame (multi-material)",
  anchored: false,
  config: { ...lamela_113_3d_ploty.config, frame_material: "steel" },
  prices: fenceSteelPrices,
  expectedDimensions: lamela_113_3d_ploty.expectedDimensions,
  expectedFill: lamela_113_3d_ploty.expectedFill,
  // h-profil 32×130 + Výplň 163×175 + Sloup 10×640 = 4160 + 28525 + 6400 = 39 085;
  // accessory unchanged 6 265.8 ; 2 000 ; 2 600. Total 49 950.8.
  expectedMoney: {
    material: "39085",
    accessory: "6265.8",
    manufacturing: "2000",
    installation: "2600",
    total: "49950.8",
  },
};

export const fenceGoldens: FenceGoldenCase[] = [
  lamela_113_3d_ploty,
  planka_100_2d_ploty,
  lamela_113_3d_steel,
];
