/**
 * Step-4 proving harness (CORE_SPEC §10.4) — the site graph on authored data:
 * GATE — fenceA — fenceB on stepped terrain against `catalog@2`.
 *
 *   I6  — the post between two runs (and the gate-side post) has exactly ONE
 *         owner; the aggregate counts it once, structurally.
 *   I11 — a single gate is a site with one instance: the degenerate aggregate
 *         IS the standalone Excel-anchored result, string-exact.
 *   §5  — stepped terrain drives each instance's elevation parameter; the
 *         fence model's connection rule decides stepped vs invalid.
 *   I3  — site stamps pin every instance's release + the catalog/price-table
 *         versions (catalog@1 keeps serving the step-1..3 goldens unchanged —
 *         two immutable catalog releases coexist in this corpus).
 */
import { describe, expect, it } from "vitest";

import { deriveInstance, deriveSite, type SiteInstance } from "@repo/engine";
import { validateRelease, type Site } from "@repo/model";

import { catalogV2 } from "./catalog/catalog-v2";
import {
  siteFenceConfig,
  siteGateConfig,
  siteGolden,
  sitePrices,
  steppedSite,
} from "./golden/site";
import { planka_100_2d_3panel } from "./golden/sliding-gate";
import { fenceRunV1 } from "./releases/fence-run";
import { slidingGateV1 } from "./releases/sliding-gate";

const instances = (): SiteInstance[] => [
  { instanceId: "gate", release: slidingGateV1, input: siteGateConfig },
  { instanceId: "fenceA", release: fenceRunV1, input: siteFenceConfig },
  { instanceId: "fenceB", release: fenceRunV1, input: siteFenceConfig },
];

describe("fence-run@1 — publish gate (validateRelease)", () => {
  it("has zero defects against catalog@2", () => {
    expect(validateRelease(fenceRunV1, catalogV2)).toEqual([]);
  });

  it("sliding-gate@1 (with ports + terrain) also validates against catalog@2", () => {
    expect(validateRelease(slidingGateV1, catalogV2)).toEqual([]);
  });
});

describe("fence-run@1 — standalone derivation (the new family's own lock)", () => {
  const result = deriveInstance(fenceRunV1, siteFenceConfig, sitePrices, catalogV2);

  it("derives the hand-computed chain", () => {
    expect(result.isValid).toBe(true);
    for (const [key, expected] of Object.entries(siteGolden.fence.dimensions)) {
      expect(result.derived[key], key).toBe(expected);
    }
  });

  it("totals the hand-computed money string (I10)", () => {
    expect(result.money.total).toBe(siteGolden.fence.moneyTotal);
  });

  it("a standalone run keeps BOTH end posts (sharing is connection-scoped)", () => {
    const posts = result.parts.filter((p) => p.componentCode === "fence_post_60");
    expect(posts.map((p) => p.path)).toEqual(["posts.start", "posts.end", "posts.line"]);
  });
});

describe("site graph — GATE — fenceA — fenceB on stepped terrain (I6/I11)", () => {
  const result = deriveSite(steppedSite, instances(), sitePrices, catalogV2);

  it("is valid: every step within the fence model's 200 mm rule", () => {
    expect(result.isValid).toBe(true);
    expect(result.issues.filter((i) => i.severity === "error")).toHaveLength(0);
  });

  it("terrain drives each instance's top line (§5)", () => {
    expect(result.instances.gate!.derived.topLine).toBe(siteGolden.site.topLines.gate);
    expect(result.instances.fenceA!.derived.topLine).toBe(siteGolden.site.topLines.fenceA);
    expect(result.instances.fenceB!.derived.topLine).toBe(siteGolden.site.topLines.fenceB);
  });

  it("resolves both shared posts to one owner each (I6)", () => {
    expect(result.sharing).toEqual([
      {
        connection: 0,
        ownerInstanceId: "gate",
        ownerPartPath: "frame.tower_post",
        consumerInstanceId: "fenceA",
        consumedPartPath: "posts.start",
      },
      {
        connection: 1,
        ownerInstanceId: "fenceA",
        ownerPartPath: "posts.end",
        consumerInstanceId: "fenceB",
        consumedPartPath: "posts.start",
      },
    ]);
  });

  it("counts shared elements once in the aggregate BOM (I6)", () => {
    const posts = result.bom.find((l) => l.componentCode === "fence_post_60");
    expect(posts?.quantity).toBe(siteGolden.site.fencePostCount);
    expect(posts?.sources).toEqual([
      { instanceId: "fenceA", path: "posts.end" },
      { instanceId: "fenceA", path: "posts.line" },
      { instanceId: "fenceB", path: "posts.end" },
      { instanceId: "fenceB", path: "posts.line" },
    ]);
  });

  it("merges same-component lines across releases (gate + fence labor)", () => {
    const labor = result.bom.find((l) => l.componentCode === "manufacturing");
    expect(labor?.quantity).toBe(siteGolden.site.manufacturingHours);
    expect(labor?.sources.map((s) => s.instanceId)).toEqual(["gate", "fenceA", "fenceB"]);
  });

  it("aggregate money is string-exact: anchor + 2 fences − 2 shared posts (I10)", () => {
    expect(result.money).toEqual(siteGolden.site.moneyTotals);
  });

  it("stamps every release pin + catalog@2 + the site price table (I3)", () => {
    expect(result.stamps).toEqual({
      releaseIds: { gate: "sliding-gate@1", fenceA: "fence-run@1", fenceB: "fence-run@1" },
      catalogVersion: 2,
      priceTableVersion: 2,
      overrideIds: [],
    });
  });

  it("is deterministic — re-derivation is byte-identical (I1)", () => {
    expect(JSON.stringify(deriveSite(steppedSite, instances(), sitePrices, catalogV2))).toBe(
      JSON.stringify(result),
    );
  });

  it("removing the fence joint restores fenceB's start post (layering, I8)", () => {
    const unjoined: Site = { ...steppedSite, connections: [steppedSite.connections[0]!] };
    const result = deriveSite(unjoined, instances(), sitePrices, catalogV2);
    expect(result.isValid).toBe(true);
    expect(result.bom.find((l) => l.componentCode === "fence_post_60")?.quantity).toBe(
      siteGolden.siteWithoutFenceJoint.fencePostCount,
    );
    expect(result.money.total).toBe(siteGolden.siteWithoutFenceJoint.moneyTotal);
  });
});

describe("site graph — the degenerate single-gate site (I11)", () => {
  it("aggregate equals the standalone Excel anchor, string-exact", () => {
    const alone = deriveInstance(
      slidingGateV1,
      planka_100_2d_3panel.config,
      planka_100_2d_3panel.prices,
      catalogV2,
    );
    const result = deriveSite(
      {
        id: "site-degenerate",
        terrain: [],
        placements: [{ instanceId: "gate", pose: { origin_mm: { x: 0, y: 0 } } }],
        connections: [],
      },
      [{ instanceId: "gate", release: slidingGateV1, input: planka_100_2d_3panel.config }],
      planka_100_2d_3panel.prices,
      catalogV2,
    );
    expect(result.isValid).toBe(true);
    expect(result.money.total).toBe(String(planka_100_2d_3panel.expectedTotalPrice));
    expect(result.totals).toEqual(alone.totals);
    expect(result.instances.gate).toEqual(alone);
  });
});

describe("site graph — the invalid step (connection constraints kill the site)", () => {
  it("a 400 mm terrain step fails fence.connection.top_step on both ends (I5)", () => {
    const tooSteep: Site = {
      ...steppedSite,
      terrain: [
        { id: "s1", elevation_mm: 0 },
        { id: "s2", elevation_mm: 400 },
      ],
    };
    const result = deriveSite(tooSteep, instances(), sitePrices, catalogV2);
    expect(result.isValid).toBe(false);
    expect(result.bom).toEqual([]);
    expect(result.totals.total).toBe(0);
    expect(result.issues).toEqual([
      {
        key: "fence.connection.top_step",
        severity: "error",
        scope: "connection",
        params: { connection: 1, self: "fenceA", other: "fenceB" },
      },
      {
        key: "fence.connection.top_step",
        severity: "error",
        scope: "connection",
        params: { connection: 1, self: "fenceB", other: "fenceA" },
      },
    ]);
  });
});
