/**
 * Golden corpus for `sliding-gate@1` (CORE_SPEC I2) — ported verbatim from the
 * MVP calc-engine's Excel-anchored fixtures. These are the delta-0 lock: the
 * release cannot be "published" unless the engine reproduces every expected
 * value here byte-identically.
 *
 *   planka_100_2d_3panel — THE Excel anchor (sheet Kalkulace U34 = 81,451.504).
 *   lamela_113_3d_2panel — the 3D / 2-panel path (1.4 rail multiplier),
 *                          regression-locked to the corrected MVP engine.
 *
 * `prices` mirrors the MVP PriceTable; the engine injects it as the `price.*`
 * cascade layer (CORE_SPEC §4).
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
  manufacturing: { rate: 790, multiplier: 16 },
  installation: 10500,
};

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
    components: {
      sloupek_l_50: 427,
      sloupek_t_50: 495,
      h_profile_50: 200,
      planka_100: 250,
      top_guide_beam: 280,
      tower_post: 2873,
      gear_rack: 180,
      diagonal_tensioner: 1531,
      frame_kit: 1300,
      motor: 12600,
      fill_connector: 5,
      gsm_module: 491,
      rack_mount: 192,
      guide_roller: 333,
    },
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
  expectedTotalPrice: 81451.504,
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
    components: {
      sloupek_l_50: 427,
      sloupek_t_50: 495,
      h_profile_50: 200,
      lamela_113: 217,
      top_guide_beam: 280,
      tower_post: 2873,
      gear_rack: 180,
      diagonal_tensioner: 1531,
      frame_kit: 1300,
      motor: 12600,
      fill_connector: 5,
      gsm_module: 491,
      rack_mount: 192,
      guide_roller: 333,
    },
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

export const slidingGateGoldens: SlidingGoldenCase[] = [planka_100_2d_3panel, lamela_113_3d_2panel];
