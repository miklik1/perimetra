/**
 * Golden corpus for the step-4 site graph (CORE_SPEC §10.4): GATE — fenceA —
 * fenceB on stepped terrain. A REGRESSION lock (`anchored: false`) — the gate is
 * the Excel-anchored planka delta-0 (81 451.5), the fences are the FIL `Ploty`
 * family (CAR-32) whose STANDALONE byte-true Excel anchor lives in
 * `golden/fence-run.ts`; the aggregate here is engine-derived (site prices +
 * per-part post rounding at the 1500 mm height, so it is NOT the fence's byte-
 * true H = 2000 anchor) and locks the site COMPOSITION mechanics:
 *
 *   gate 81 451.5 + fenceA 28 796 + fenceB 28 796
 *     − 2 × 2 160 shared post metres (I6: fenceA.start → gate tower post,
 *                                          fenceB.start → fenceA end post)
 *     = 134 723.5 at the haléř money boundary (ADR 0081)
 *
 * The shared post is the Sloup 100 PROFILE metres (2 m × 1080 = 2160); its
 * caps/footing are NOT shared (a documented follow-up — see fence-run.ts), so
 * the aggregate keeps both boundary runs' cap sets.
 *
 * Fence (run 5 000 × 1 500, planka_100_2d, no install): fieldCount 2, fieldWidth
 * 2500, fillCount 13, fillPitch 116, fillZoneHeight 1492; posts 3 × Sloup 100 (6
 * m × 1080), h-25 carriers, planka fill, caps/footing/connector, Výroba 2 × 500.
 *
 * Terrain: gate + fenceA on s1 (0), fenceB on s2 (+150) — top lines 1 500 /
 * 1 500 / 1 650, every step ≤ the fence model's 200 mm rule. The negative
 * corpus raises s2 to +400 and the connection constraint must kill the site.
 */
import type { ConfigInput, CostTable, PriceTable } from "@repo/engine";
import type { Site } from "@repo/model";

/** The site price table: the alu gate table (golden/sliding-gate.ts) plus the
 *  fence SKUs — a NEW versioned table, not an edit of v1 (I3). */
export const sitePrices: PriceTable = {
  version: 2,
  components: {
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
    // Fill prices — the 2026 Excel `Výplet` H-column (cena/m), so the live
    // configurator can price all seven infill types. 2D/3D of one profile share
    // a component + price.
    planka_100: 250,
    lamela_113: 217,
    lamela_120: 275,
    planka_120: 275,
    // Fence components (FIL `Ploty`, CAR-32). h_profile_50 (200) + fill_connector
    // (5) are the gate's shared components; the fence at planka_100_2d uses the
    // 2D carrier h_profile_25. Labour is flat per-field (Výroba/Montáž components).
    sloup_100: 1080,
    h_profile_25: 140,
    krytka_roof: 156,
    krytka_sloup_100: 156,
    krytka_h_profile: 5,
    patka_sloup: 850,
    fence_manufacturing: 500,
    fence_installation: 650,
  },
  manufacturing: { rate: 790, multiplier: 16 },
  installation: 10500,
};

/** Cost-of-goods for the site price table (ADR 0059): per-component buy cost,
 *  the manufacturing wage `rate` (420 vs the 790 billed), and the installation
 *  cost (6200 vs 10500 billed). Same shape as the sell table, shares its version
 *  (co-located row, I3). `manufacturing.multiplier` is unused for cost (labour
 *  hours are physical, fixed from the sell side) — mirrored only for shape. */
export const siteCosts: CostTable = {
  components: {
    sloupek_l_50: 270,
    sloupek_t_50: 310,
    h_profile_50: 120,
    top_guide_beam: 175,
    tower_post: 1800,
    gear_rack: 110,
    diagonal_tensioner: 950,
    rail_set_enzo: 8000,
    rail_set_enzo_long: 16000,
    frame_kit: 820,
    motor: 8800,
    fill_connector: 3,
    gsm_module: 310,
    rack_mount: 120,
    guide_roller: 210,
    // Fill buy-costs — DEMO values (this whole cost table is demo, not FIL data),
    // at planka_100's ~0.62 sell ratio so margin stays plausible until real
    // supplier costs land (the FIL/price slice). One per shared fill component.
    planka_100: 155,
    lamela_113: 135,
    lamela_120: 170,
    planka_120: 170,
    // Fence component buy-costs — DEMO (this whole cost table is demo, not FIL).
    sloup_100: 650,
    h_profile_25: 85,
    krytka_roof: 95,
    krytka_sloup_100: 95,
    krytka_h_profile: 3,
    patka_sloup: 520,
    fence_manufacturing: 300,
    fence_installation: 400,
  },
  manufacturing: { rate: 420, multiplier: 16 },
  installation: 6200,
};

/** The Excel-anchored gate config (golden/sliding-gate.ts), elevation via s1. */
export const siteGateConfig: ConfigInput = {
  opening_width_mm: 4000,
  clear_height_mm: 1500,
  suspension_angle: 35,
  panel_count: 3,
  fill_type_id: "planka_100_2d",
  opening_direction: "left",
  include_motor: true,
  include_installation: true,
  manufacturing_hours: 18,
};

/** Both runs identical on purpose: the 350 CZK delta between them in the
 *  aggregate is EXACTLY the shared post (I6), nothing else. */
export const siteFenceConfig: ConfigInput = {
  run_length_mm: 5000,
  clear_height_mm: 1500,
  fill_type_id: "planka_100_2d",
  include_installation: false,
};

/** GATE — fenceA — fenceB, fenceB one terrain step (+150) up. */
export const steppedSite: Site = {
  id: "site-fil-1",
  terrain: [
    { id: "s1", elevation_mm: 0 },
    { id: "s2", elevation_mm: 150 },
  ],
  placements: [
    { instanceId: "gate", pose: { origin_mm: { x: 0, y: 0 } }, terrainSegmentId: "s1" },
    { instanceId: "fenceA", pose: { origin_mm: { x: 4200, y: 0 } }, terrainSegmentId: "s1" },
    { instanceId: "fenceB", pose: { origin_mm: { x: 9200, y: 0 } }, terrainSegmentId: "s2" },
  ],
  connections: [
    { a: { instanceId: "gate", portId: "right" }, b: { instanceId: "fenceA", portId: "start" } },
    { a: { instanceId: "fenceA", portId: "end" }, b: { instanceId: "fenceB", portId: "start" } },
  ],
};

export const siteGolden = {
  /** Standalone fence run (engine-derived regression; the byte-true H = 2000
   *  Excel anchor is `golden/fence-run.ts`). */
  fence: {
    dimensions: {
      fieldCount: 2,
      innerPostCount: 1,
      fieldWidth: 2500,
      postCount: 3,
      postLength: 1500,
      fillCount: 13,
      fillPitch: 116,
      fillZoneHeight: 1492,
      lamellaTotal: 26,
      topLine: 1500,
    },
    moneyTotal: "28796",
    /** Cost-of-goods (ADR 0059, siteCosts): Sloup 6 m × 650 + h-25 2 m × 85 +
     *  planka 64 m × 155 + caps/footing/connector; + Výroba 2 × 300. */
    costMoneyTotal: "17660",
  },
  /** The aggregate (gate anchor + 2 fences − 2 shared post metres, I6). */
  site: {
    moneyTotals: {
      material: "69183",
      accessory: "38820.5",
      manufacturing: "16220",
      installation: "10500",
      total: "134723.5",
    },
    /** Cost-of-goods over the SAME shared parts (I6): shares costed once, like
     *  the price. Margin = (134723.5 − 82889.86)/134723.5 ≈ 38.47 %. */
    costMoney: {
      material: "42777.5",
      accessory: "25152.36",
      manufacturing: "8760",
      installation: "6200",
      total: "82889.86",
    },
    /** Sloup 100 metres across both runs after sharing: fenceA end+line (2+2) +
     *  fenceB end+line (2+2) = 8 m; both start posts (2 m each) are consumed. */
    sloupMeters: 8,
    /** The gate's `manufacturing` line is hours (18); the fence bills the FLAT
     *  per-field `fence_manufacturing` component, so it no longer merges here. */
    gateManufacturingHours: 18,
    /** fence_manufacturing merged across fenceA + fenceB (2 fields each). */
    fenceManufacturingFields: 4,
    marginPct: 38.47,
    topLines: { gate: 1500, fenceA: 1500, fenceB: 1650 },
  },
  /** Aggregate with connection 1 (fenceA—fenceB) removed: fenceB's start post
   *  is no longer consumed — removing the connection restores the part (I8's
   *  cascade discipline, structurally): +2 m Sloup (2160) → 136 883.5. */
  siteWithoutFenceJoint: { moneyTotal: "136883.5", sloupMeters: 10 },
} as const;
