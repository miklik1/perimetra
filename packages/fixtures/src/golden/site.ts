/**
 * Golden corpus for the step-4 site graph (CORE_SPEC §10.4): GATE — fenceA —
 * fenceB on stepped terrain, hand-derived (no Excel anchor; `anchored: false`
 * regression locks, like the steel case). The gate instance reuses the
 * Excel-anchored planka config, so the aggregate carries the delta-0 lineage:
 *
 *   gate (81 451.504, the U34 anchor)
 *   + fenceA (24 570) + fenceB (24 570)
 *   − 2 × 350 shared posts (I6: fenceA.start → gate tower post,
 *                                fenceB.start → fenceA end post)
 *   = 129 891.504 raw → 129 891.5 at the haléř money boundary (ADR 0081)
 *
 * Fence hand-derivation (run 5 000 × 1 500, planka fill, 8 h, no install):
 *   fieldCount = roundUp(5000/2500) = 2 ; innerPostCount = 1 ; fieldWidth 2500
 *   postLength = 2000 ; fillRows = floor(1400/101) = 13 ; fillPieces = 26
 *   posts 3×350 + rails roundUp(10)×95 + fill roundUp(26×2500/1000)×250
 *     = 1 050 + 950 + 16 250 = 18 250 material ; + 8×790 = 6 320 manufacturing
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
    planka_100: 250,
    fence_post_60: 350,
    fence_rail_40x20: 95,
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
    planka_100: 155,
    fence_post_60: 210,
    fence_rail_40x20: 58,
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
  manufacturing_hours: 8,
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
  /** Standalone fence run (hand-derived above). */
  fence: {
    dimensions: {
      fieldCount: 2,
      innerPostCount: 1,
      fieldWidth: 2500,
      postLength: 2000,
      fillRows: 13,
      fillPieces: 26,
      topLine: 1500,
    },
    moneyTotal: "24570",
    /** Cost-of-goods (ADR 0059, siteCosts): posts 3×210 + rails 10×58 + fill
     *  65×155 = 11 285 material; 8 h × 420 wage = 3 360 manufacturing. */
    costMoneyTotal: "14645",
  },
  /** The aggregate (delta-0 lineage: gate anchor + 2 fences − 2 shared posts). */
  site: {
    moneyTotals: {
      material: "60983",
      accessory: "31548.5",
      manufacturing: "26860",
      installation: "10500",
      total: "129891.5",
    },
    /** Cost-of-goods over the SAME shared parts (I6): shares costed once, like
     *  the price. Margin = (129891.5 − 79039.86)/129891.5 ≈ 39.15 %.
     *  Re-baselined to haléř (ADR 0081): accessory/total .504 → .5; cost is
     *  already at haléř (79039.86) so it is unchanged. */
    costMoney: {
      material: "37847.5",
      accessory: "20712.36",
      manufacturing: "14280",
      installation: "6200",
      total: "79039.86",
    },
    /** fence_post_60 across both runs after sharing: 2 + 2 (each run keeps
     *  end + line; both start posts are consumed). */
    fencePostCount: 4,
    /** 18 h gate + 8 h per fence, merged by component code. */
    manufacturingHours: 34,
    topLines: { gate: 1500, fenceA: 1500, fenceB: 1650 },
  },
  /** Aggregate with connection 1 (fenceA—fenceB) removed: fenceB's start post
   *  is no longer consumed — removing the connection restores the part (I8's
   *  cascade discipline, structurally). */
  siteWithoutFenceJoint: { moneyTotal: "130241.5", fencePostCount: 5 },
} as const;
