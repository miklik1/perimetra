/**
 * Golden corpus for `sliding-gate@1` (CORE_SPEC I2) — ported verbatim from the
 * MVP calc-engine's Excel-anchored fixtures. These are the delta-0 lock: the
 * release cannot be "published" unless the engine reproduces every expected
 * value here byte-identically.
 *
 *   planka_100_2d_3panel — THE Excel anchor (sheet Kalkulace U34 = 81,451.504).
 *   lamela_113_3d_2panel — the 3D / 2-panel path (1.4 rail multiplier),
 *                          regression-locked to the corrected MVP engine.
 *   steel_frame_3panel   — the planka anchor re-derived in steel (step 2
 *                          multi-material; same geometry, steel SKU prices).
 *
 * `prices` mirrors the MVP PriceTable; the engine injects it as the `price.*`
 * cascade layer (CORE_SPEC §4). The ENZO rail sets are priced HERE (two SKUs)
 * — the release holds no CZK literals (price truth; the U28 ternary is dead).
 */
import type { ConfigInput, PriceTable } from "@repo/engine";

export interface SlidingGoldenCase {
  name: string;
  anchored: boolean;
  config: ConfigInput;
  prices: PriceTable;
  expectedDimensions: Record<string, number>;
  expectedFill: { count: number; fillLength: number };
  expectedTotalPrice: number;
}

const sharedPrices = {
  version: 1,
  manufacturing: { rate: 790, multiplier: 16 },
  installation: 10500,
};

/** The alu component prices both MVP-ported cases share. The ENZO entries fold
 *  the MVP's `+1000` accessory add-on into the set price (U28 provenance:
 *  11650+1000 / 24500+1000). */
const aluComponents = {
  sloupek_l_50: 427,
  sloupek_t_50: 495,
  h_profile_50: 200,
  top_guide_beam: 280,
  tower_post: 2873,
  gear_rack: 180,
  diagonal_tensioner: 1531,
  rail_set_enzo: 12650,
  rail_set_enzo_long: 25500,
  frame_kit: 1300,
  motor: 12600,
  fill_connector: 5,
  gsm_module: 491,
  rack_mount: 192,
  guide_roller: 333,
};

/** The 2026 Excel `Výplet` H-column sell prices (cena/m). The 2D and 3D variant
 *  of one physical profile share a catalog component, so four prices serve all
 *  seven infill types (Excel shows identical cena/m within each pair). */
const fillPrices = {
  planka_100: 250,
  lamela_113: 217,
  lamela_120: 275,
  planka_120: 275,
};

/** Shared base config for the per-fill-type regression cases: the Excel anchor
 *  geometry (4.0 m × 1.5 m, 3-panel, 35°), varying ONLY the fill type so each
 *  new option is proven to resolve through the catalog and price correctly. */
const regressionBase: ConfigInput = {
  opening_width_mm: 4000,
  clear_height_mm: 1500,
  suspension_angle: 35,
  panel_count: 3,
  opening_direction: "left",
  include_motor: true,
  include_installation: true,
  manufacturing_hours: 18,
};

/** Dimensions every 4.0 m × 1.5 m 3-panel case shares (fill type changes only
 *  the count + piece length, never the frame chain). */
const base40Dims = {
  postA: 1320,
  postB: 1220,
  diagonal: 2214,
  railLength: 5332,
  bottomRail: 4700,
  panelWidth: 1300,
  hProfileLength: 1205,
};
const regressionPrices = { components: { ...aluComponents, ...fillPrices }, ...sharedPrices };

export const planka_100_2d_3panel: SlidingGoldenCase = {
  name: "PLAŇKA 100 2D · 3-panel · 4.0 m (Excel U34 delta-0)",
  anchored: true,
  config: {
    opening_width_mm: 4000,
    clear_height_mm: 1500,
    suspension_angle: 35,
    panel_count: 3,
    fill_type_id: "planka_100_2d",
    opening_direction: "left",
    include_motor: true,
    include_installation: true,
    manufacturing_hours: 18, // Excel T32 (hand-entered)
  },
  prices: {
    components: { ...aluComponents, planka_100: 250 },
    ...sharedPrices,
  },
  expectedDimensions: {
    postA: 1320,
    postB: 1220,
    diagonal: 2214,
    railLength: 5332,
    bottomRail: 4700,
    panelWidth: 1300,
    hProfileLength: 1205,
  },
  expectedFill: { count: 11, fillLength: 1313.3333333333333 },
  // Re-baselined to haléř under the commercial rounding policy (ADR 0081): the
  // raw delta-0 sum is 81451.504 (Excel U34), the money boundary now rounds it
  // to 81451.5 (only the sub-haléř rack_mount/accessory line moves).
  expectedTotalPrice: 81451.5,
};

export const lamela_113_3d_2panel: SlidingGoldenCase = {
  name: "Lamela 113 3D · 2-panel · 4.0 m (3D path, 1.4 rail)",
  anchored: false,
  config: {
    opening_width_mm: 4000,
    clear_height_mm: 1200,
    suspension_angle: 45,
    panel_count: 2,
    fill_type_id: "lamela_113_3d",
    opening_direction: "left",
    include_motor: true,
    include_installation: true,
    // manufacturing_hours omitted → defaults to the price-table multiplier (16).
  },
  prices: {
    components: { ...aluComponents, lamela_113: 217 },
    ...sharedPrices,
  },
  expectedDimensions: {
    postA: 1020,
    postB: 920,
    diagonal: 1372,
    railLength: 5600,
    bottomRail: 4700,
    panelWidth: 1950,
    hProfileLength: 905,
  },
  expectedFill: { count: 10, fillLength: 2000 },
  expectedTotalPrice: 75174.2,
};

/**
 * The Excel anchor re-derived in steel (step 2 multi-material proof): same
 * config + `frame_material: "steel"`, steel SKU prices added. Geometry is
 * material-independent — every expected dimension is identical to the alu
 * anchor; only the four material lines reprice (Δ −7 710 vs 81 451.504).
 * Steel prices are NOT Excel-anchored (regression-lock only).
 */
export const steel_frame_3panel: SlidingGoldenCase = {
  name: "PLAŇKA 100 2D · 3-panel · 4.0 m · STEEL frame (multi-material)",
  anchored: false,
  config: { ...planka_100_2d_3panel.config, frame_material: "steel" },
  prices: {
    components: {
      ...aluComponents,
      planka_100: 250,
      sloupek_l_50_steel: 210,
      sloupek_t_50_steel: 250,
      h_profile_50_steel: 120,
      planka_100_steel: 180,
    },
    ...sharedPrices,
  },
  expectedDimensions: planka_100_2d_3panel.expectedDimensions,
  expectedFill: planka_100_2d_3panel.expectedFill,
  // Re-baselined to haléř (ADR 0081): raw 73741.504 → 73741.5.
  expectedTotalPrice: 73741.5,
};

/**
 * The 5 m výroba Excel case (sheet `…do 5m-výroba.xlsx`, Kalkulace U34 =
 * 83 522.442) — the SECOND genuine Excel anchor: LAMELA 113 3D at 4.5 m, 3-panel.
 * The generic engine reproduces it byte-for-byte (every BOM line verified
 * cell-for-cell). Note this sheet's own motor (12 300) and JRS-30 (323) prices,
 * distinct from the 4.5 m sheet's 12 600 / 333. The raw delta-0 sum is
 * 83522.442; the money boundary rounds it to haléř (ADR 0081) → 83522.44.
 *
 * (The third workbook — `…do 4,5m - výroba.xlsx`, U34 = 81 849.192 — is NOT a
 * valid anchor: its rail formula is `=Q4*1.334`, a hand-typed VZOR-sample typo
 * for the canonical `1.333` that both the KALK sheet and this 5 m sheet use. The
 * engine's 1.333 is correct, so that workbook is deliberately not locked here.)
 */
export const lamela_113_3d_5m: SlidingGoldenCase = {
  name: "LAMELA 113 3D · 3-panel · 4.5 m (Excel 5m-výroba U34 delta-0)",
  anchored: true,
  config: {
    opening_width_mm: 4500,
    clear_height_mm: 1500,
    suspension_angle: 35,
    panel_count: 3,
    fill_type_id: "lamela_113_3d",
    opening_direction: "left",
    include_motor: true,
    include_installation: true,
    manufacturing_hours: 18,
  },
  prices: {
    components: { ...aluComponents, ...fillPrices, motor: 12300, guide_roller: 323 },
    ...sharedPrices,
  },
  expectedDimensions: {
    postA: 1320,
    postB: 1220,
    diagonal: 2214,
    railLength: 5998.5,
    bottomRail: 5200,
    panelWidth: 1466.6666666666667,
    hProfileLength: 1205,
  },
  expectedFill: { count: 13, fillLength: 1480 },
  expectedTotalPrice: 83522.44,
};

/**
 * Per-fill-type regression coverage for the five infill types added in the
 * "complete the 7 Výplet types" slice (no Excel example exists for these exact
 * configs, so they regression-lock the corrected engine, not an external anchor).
 * Each is the shared 4.0 m base config with only the fill type changed; the
 * expected total is what the engine derives against the standard alu prices.
 * fillCount = floor(1205 / min_spacing): 90→13, 105→11, 95→12, 121→9, 88→13.
 */
export const lamela_120_3d_3panel: SlidingGoldenCase = {
  name: "LAMELA 120 3D · 3-panel · 4.0 m (regression — new fill type)",
  anchored: false,
  config: { ...regressionBase, fill_type_id: "lamela_120_3d" },
  prices: regressionPrices,
  expectedDimensions: base40Dims,
  expectedFill: { count: 13, fillLength: 1313.3333333333333 },
  expectedTotalPrice: 84871.5,
};

export const planka_120_3d_3panel: SlidingGoldenCase = {
  name: "PLAŇKA 120 3D · 3-panel · 4.0 m (regression — new fill type)",
  anchored: false,
  config: { ...regressionBase, fill_type_id: "planka_120_3d" },
  prices: regressionPrices,
  expectedDimensions: base40Dims,
  expectedFill: { count: 11, fillLength: 1313.3333333333333 },
  expectedTotalPrice: 82551.5,
};

export const lamela_113_2d_3panel: SlidingGoldenCase = {
  name: "LAMELA 113 2D · 3-panel · 4.0 m (regression — new fill type)",
  anchored: false,
  config: { ...regressionBase, fill_type_id: "lamela_113_2d" },
  prices: regressionPrices,
  expectedDimensions: base40Dims,
  expectedFill: { count: 12, fillLength: 1313.3333333333333 },
  expectedTotalPrice: 80927.5,
};

export const planka_120_2d_3panel: SlidingGoldenCase = {
  name: "PLAŇKA 120 2D · 3-panel · 4.0 m (regression — new fill type)",
  anchored: false,
  config: { ...regressionBase, fill_type_id: "planka_120_2d" },
  prices: regressionPrices,
  expectedDimensions: base40Dims,
  expectedFill: { count: 9, fillLength: 1313.3333333333333 },
  expectedTotalPrice: 80231.5,
};

export const planka_100_3d_3panel: SlidingGoldenCase = {
  name: "PLAŇKA 100 3D · 3-panel · 4.0 m (regression — new fill type)",
  anchored: false,
  config: { ...regressionBase, fill_type_id: "planka_100_3d" },
  prices: regressionPrices,
  expectedDimensions: base40Dims,
  expectedFill: { count: 13, fillLength: 1313.3333333333333 },
  expectedTotalPrice: 83571.5,
};

export const slidingGateGoldens: SlidingGoldenCase[] = [
  planka_100_2d_3panel,
  lamela_113_3d_2panel,
  steel_frame_3panel,
  lamela_113_3d_5m,
  lamela_120_3d_3panel,
  planka_120_3d_3panel,
  lamela_113_2d_3panel,
  planka_120_2d_3panel,
  planka_100_3d_3panel,
];
