/**
 * Step-5 proving harness (CORE_SPEC §10.5) — the renderers on the step-4
 * corpus: GATE — fenceA — fenceB on stepped terrain. The single assertion
 * behind every test here is I4: cut list, 3D scene, and 2D drawings derive
 * from the ONE site graph — the renderers receive (Site, SiteResult) and
 * nothing else; no renderer ever sees a config, a release, or the catalog.
 *
 *   I6  — the consumed start posts vanish from scene, plan, and saw alike;
 *         the cut list cuts exactly 4 fence posts, matching the BOM golden.
 *   §5  — stepped terrain shows up as geometry: fenceB's pieces sit 150 up.
 *   §6  — an artifact override renders as a mandatory deviation flag on the
 *         workshop drawing; the workshop always sees what deviated.
 *
 * Hand-derived piece counts (gate 4000×1500, planka, 3 panels):
 *   lprofile 5 (postA, postB, diagonal, bottom, rail) + tpost 2 + hprofile 6
 *   + fill 33 (fillCount 11 × 3) + guide beam 1 + tower post 1 = 48
 * Fence (5000×1500, planka): posts 3 + rails 2 + fill 26 = 31 standalone;
 * 30 once its start post is consumed (I6).
 */
import { describe, expect, it } from "vitest";

import { deriveInstance, deriveSite, type SiteInstance } from "@repo/engine";
import type { Catalog, Override } from "@repo/model";
import { buildCutList, buildScene, buildSitePlan, buildWorkshopDrawing } from "@repo/renderers";

import { catalogV2 } from "./catalog/catalog-v2.js";
import { siteFenceConfig, siteGateConfig, sitePrices, steppedSite } from "./golden/site.js";
import { fenceRunV1 } from "./releases/fence-run.js";
import { slidingGateV1 } from "./releases/sliding-gate.js";

const instances = (): SiteInstance[] => [
  { instanceId: "gate", release: slidingGateV1, input: siteGateConfig },
  { instanceId: "fenceA", release: fenceRunV1, input: siteFenceConfig },
  { instanceId: "fenceB", release: fenceRunV1, input: siteFenceConfig },
];

// Both releases on catalog@2, keyed by releaseId (per-release catalog, ADR 0065).
const siteCatalogs = new Map<string, Catalog>([
  ["sliding-gate@1", catalogV2],
  ["fence-run@1", catalogV2],
]);

const siteResult = deriveSite(steppedSite, instances(), sitePrices, siteCatalogs);

describe("scene 3D — the site as placed pieces (I4/I6/§5)", () => {
  const scene = buildScene(steppedSite, siteResult);

  it("groups instances under their site poses, in placement order", () => {
    expect(scene.instances.map((i) => i.instanceId)).toEqual(["gate", "fenceA", "fenceB"]);
    expect(scene.instances[0]!.at).toEqual([0, 0, 0]);
    expect(scene.instances[1]!.at).toEqual([4200, 0, 0]);
    expect(scene.instances[2]!.at).toEqual([9200, 0, 0]);
  });

  it("emits the hand-derived piece counts, consumed posts dropped (I6)", () => {
    const counts = Object.fromEntries(scene.instances.map((i) => [i.instanceId, i.pieces.length]));
    expect(counts).toEqual({ gate: 48, fenceA: 30, fenceB: 30 });
    const fenceAPieceIds = scene.instances[1]!.pieces.map((p) => p.id);
    expect(fenceAPieceIds).not.toContain("fenceA/posts.start/post");
    expect(fenceAPieceIds).toContain("fenceA/posts.end/post");
  });

  it("stepped terrain lifts fenceB's pieces by the segment elevation (§5)", () => {
    const post = (instance: number): { at: [number, number, number] } =>
      scene.instances[instance]!.pieces.find((p) => p.id.endsWith("posts.end/post"))!;
    expect(post(1).at).toEqual([5000, 0, 0]);
    expect(post(2).at).toEqual([5000, 150, 0]);
  });

  it("a standalone fence keeps all 31 pieces (sharing is connection-scoped)", () => {
    const standalone = deriveInstance(fenceRunV1, siteFenceConfig, sitePrices, catalogV2);
    const pieces = standalone.parts.flatMap((p) => p.geometry?.pieces ?? []);
    expect(pieces).toHaveLength(31);
  });

  it("carries baked profiles — no renderer opens the catalog (I4)", () => {
    const post = scene.instances[1]!.pieces.find((p) => p.id.endsWith("posts.end/post"))!;
    expect(post.profile).toEqual({ shape: "rect_tube", wMm: 60, dMm: 60 });
  });
});

describe("cut list — physical truth off the same graph (I4/I6)", () => {
  const cutList = buildCutList(siteResult);

  it("cuts exactly 4 fence posts after sharing — the BOM golden, at the saw", () => {
    const posts = cutList.components.find((c) => c.componentCode === "fence_post_60")!;
    expect(posts.lines).toEqual([expect.objectContaining({ lengthMm: 2000, count: 4 })]);
    // FFD into 6 m bars: 3 posts + 1 post.
    expect(posts.nesting!.bars.map((b) => b.cuts.length)).toEqual([3, 1]);
    expect(posts.nesting!.bars.map((b) => b.offcutMm)).toEqual([0, 4000]);
    expect(posts.nesting!.oversize).toEqual([]);
  });

  it("the suspension diagonal carries its mitre cut (35° = 2100 arc-min, I10)", () => {
    const lProfile = cutList.components.find((c) => c.componentCode === "sloupek_l_50")!;
    expect(lProfile.lines).toHaveLength(5);
    const diagonal = lProfile.lines.find((l) => l.cutArcMin !== undefined)!;
    expect(diagonal.cutArcMin).toEqual({ left: 35 * 60, right: 90 * 60 });
    expect(diagonal.sources).toEqual(["gate/frame.lprofile/diagonal"]);
    // 5 pieces nest into 3 six-meter bars (rail | bottom+postB | diagonal+postA).
    expect(lProfile.nesting!.bars).toHaveLength(3);
  });

  it("rolled-up BOM meters and per-piece cuts coexist (planka: 33 + 2×26)", () => {
    const planka = cutList.components.find((c) => c.componentCode === "planka_100")!;
    expect(planka.totalPieces).toBe(33 + 26 + 26);
    // No stock length in the catalog → no nesting, never a guessed bar (I5).
    expect(planka.nesting).toBeUndefined();
  });

  it("labor never reaches the saw — BOM-only parts have no cuts", () => {
    expect(cutList.components.map((c) => c.componentCode)).not.toContain("manufacturing");
  });
});

describe("workshop drawing — front elevation + the §6 deviation flag", () => {
  it("projects the standalone fence to its exact envelope", () => {
    const standalone = deriveInstance(fenceRunV1, siteFenceConfig, sitePrices, catalogV2);
    const drawing = buildWorkshopDrawing(standalone);
    expect(drawing.quads).toHaveLength(31);
    // Posts are 60 wide on centerline 0/5000: x ∈ [−30, 5030]; 2000 tall.
    expect(drawing.bbox).toEqual({ min: { x: -30, y: 0 }, max: { x: 5030, y: 2000 } });
    expect(drawing.dims.map((d) => [d.id, d.valueMm])).toEqual([
      ["overall.width", 5060],
      ["overall.height", 2000],
    ]);
    expect(drawing.flags).toEqual([]);
  });

  it("renders an artifact override as a mandatory deviation flag (§6)", () => {
    const override: Override = {
      id: "q-post-1950",
      scope: "quote",
      scopeRef: "quote-1",
      target: "artifact:posts.end.lengthMm",
      value: 1950,
      author: "sales@fil",
      reason: "skála pod koncovým sloupkem",
      createdAt: "2026-06-12T00:00:00.000Z",
    };
    const deviated = deriveInstance(fenceRunV1, siteFenceConfig, sitePrices, catalogV2, {
      overrides: { quote: [override] },
    });
    expect(deviated.isValid).toBe(true);
    const drawing = buildWorkshopDrawing(deviated);
    expect(drawing.flags).toEqual([
      {
        partPath: "posts.end",
        field: "lengthMm",
        original: 2000,
        value: 1950,
        overrideId: "q-post-1950",
        reason: "skála pod koncovým sloupkem",
      },
    ]);
  });
});

describe("site plan — top view with anchors, sharing, terrain", () => {
  const plan = buildSitePlan(steppedSite, siteResult);

  it("draws connections between evaluated port anchors (world plan mm)", () => {
    // gate.right anchor (outerFrameWidth+150 = 4350) → fenceA.start (4200).
    expect(plan.connections[0]!.from).toEqual({ x: 4350, y: 0 });
    expect(plan.connections[0]!.to).toEqual({ x: 4200, y: 0 });
    // fenceA.end and fenceB.start meet at world x = 9200.
    expect(plan.connections[1]!.from).toEqual({ x: 9200, y: 0 });
    expect(plan.connections[1]!.to).toEqual({ x: 9200, y: 0 });
  });

  it("marks the one owned element on each sharing connection (I6)", () => {
    expect(plan.connections[0]!.shared).toEqual({
      ownerInstanceId: "gate",
      partPath: "frame.tower_post",
    });
    expect(plan.connections[1]!.shared).toEqual({
      ownerInstanceId: "fenceA",
      partPath: "posts.end",
    });
  });

  it("annotates terrain segments with their instances (§5)", () => {
    expect(plan.terrain).toEqual([
      { id: "s1", elevationMm: 0, instanceIds: ["gate", "fenceA"] },
      { id: "s2", elevationMm: 150, instanceIds: ["fenceB"] },
    ]);
  });
});
