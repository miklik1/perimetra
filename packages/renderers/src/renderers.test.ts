/**
 * Unit tests on synthetic derived data — the renderer mechanics in isolation.
 * The real-corpus goldens (gate + fences on stepped terrain) live in
 * @repo/fixtures, the proving harness.
 */
import { describe, expect, it } from "vitest";

import type { DerivationResult, Part, SiteResult } from "@repo/engine";
import type { Site } from "@repo/model";

import { buildCutList } from "./cutlist.js";
import { buildSitePlan, buildWorkshopDrawing } from "./drawing2d.js";
import { buildScene } from "./scene3d.js";
import { cosArcMin, rotate, sinArcMin } from "./shared.js";

const part = (path: string, overrides: Partial<Part> = {}): Part => ({
  path,
  componentCode: "post_60",
  name: "Post",
  unit: "piece",
  quantity: 1,
  category: "material",
  pricePerUnit: 100,
  totalPrice: 100,
  geometry: {
    profile: { shape: "rect_tube", wMm: 60, dMm: 60 },
    pieces: [{ id: "main", lengthMm: 2000, at: [0, 0, 0], rotationArcMin: [0, 0, 5400] }],
  },
  ...overrides,
});

const instanceResult = (parts: Part[]): DerivationResult => ({
  isValid: true,
  derived: {},
  parts,
  totals: { material: 0, accessory: 0, manufacturing: 0, installation: 0, total: 0 },
  money: { material: "0", accessory: "0", manufacturing: "0", installation: "0", total: "0" },
  issues: [],
  stamps: { releaseId: "m@1", catalogVersion: 1, priceTableVersion: 1, overrideIds: [] },
});

const siteResult = (
  instances: Record<string, DerivationResult>,
  sharing: SiteResult["sharing"] = [],
): SiteResult => ({
  isValid: true,
  instances,
  sharing,
  bom: [],
  totals: { material: 0, accessory: 0, manufacturing: 0, installation: 0, total: 0 },
  money: { material: "0", accessory: "0", manufacturing: "0", installation: "0", total: "0" },
  issues: [],
  stamps: {
    releaseIds: Object.fromEntries(Object.keys(instances).map((id) => [id, "m@1"])),
    catalogVersion: 1,
    priceTableVersion: 1,
    overrideIds: [],
  },
});

const site = (instanceIds: string[], connections: Site["connections"] = []): Site => ({
  id: "s",
  terrain: [{ id: "t1", elevation_mm: 0 }],
  placements: instanceIds.map((instanceId, i) => ({
    instanceId,
    pose: { origin_mm: { x: i * 5000, y: 0 } },
    terrainSegmentId: "t1",
  })),
  connections,
});

describe("arc-minute trig", () => {
  it("is EXACT at quarter turns — vertical posts keep integer geometry", () => {
    expect(cosArcMin(5400)).toBe(0);
    expect(sinArcMin(5400)).toBe(1);
    expect(cosArcMin(-5400)).toBe(0);
    expect(sinArcMin(10800)).toBe(0);
    // A 2000 post rotated up: endpoint lands on exactly (0, 2000, 0).
    expect(rotate([2000, 0, 0], [0, 0, 5400])).toEqual([0, 2000, 0]);
  });
});

describe("buildScene", () => {
  it("drops consumed pieces (I6) and flags deviated parts", () => {
    const result = siteResult(
      {
        a: instanceResult([part("posts.end")]),
        b: instanceResult([
          part("posts.start"),
          part("posts.end", {
            deviations: [{ field: "lengthMm", value: 1950, overrideId: "ov1" }],
          }),
        ]),
      },
      [
        {
          connection: 0,
          ownerInstanceId: "a",
          ownerPartPath: "posts.end",
          consumerInstanceId: "b",
          consumedPartPath: "posts.start",
        },
      ],
    );
    const scene = buildScene(site(["a", "b"]), result);
    const ids = scene.instances.flatMap((i) => i.pieces.map((p) => p.id));
    expect(ids).toEqual(["a/posts.end/main", "b/posts.end/main"]);
    expect(scene.instances[1]!.pieces[0]!.deviated).toBe(true);
    expect(scene.instances[1]!.at).toEqual([5000, 0, 0]);
  });

  it("refuses an invalid result (I5)", () => {
    const invalid = { ...siteResult({}), isValid: false };
    expect(() => buildScene(site([]), invalid)).toThrow(/invalid/);
  });
});

describe("buildCutList", () => {
  it("merges identical cuts, nests FFD with kerf, surfaces oversize (I5)", () => {
    const pieces: NonNullable<Part["geometry"]>["pieces"] = [
      { id: "a", lengthMm: 2400, at: [0, 0, 0], rotationArcMin: [0, 0, 0] },
      { id: "b", lengthMm: 2400, at: [0, 0, 0], rotationArcMin: [0, 0, 0] },
      { id: "c", lengthMm: 1100, at: [0, 0, 0], rotationArcMin: [0, 0, 0] },
      { id: "huge", lengthMm: 7000, at: [0, 0, 0], rotationArcMin: [0, 0, 0] },
    ];
    const result = siteResult({
      a: instanceResult([
        part("rails.run", {
          componentCode: "rail_40",
          geometry: { stockLengthMm: 6000, pieces: [...pieces] },
        }),
      ]),
    });
    const list = buildCutList(result, { kerfMm: 5 });
    const rail = list.components.find((c) => c.componentCode === "rail_40")!;
    expect(rail.lines.map((l) => [l.lengthMm, l.count])).toEqual([
      [7000, 1],
      [2400, 2],
      [1100, 1],
    ]);
    // FFD into 6000: 2400 + 5 + 2400 + 5 + 1100 = 5910 — one bar; 7000 oversize.
    expect(rail.nesting!.bars).toHaveLength(1);
    expect(rail.nesting!.bars[0]!.usedMm).toBe(5910);
    expect(rail.nesting!.bars[0]!.offcutMm).toBe(90);
    expect(rail.nesting!.oversize).toEqual([{ lengthMm: 7000, source: "a/rails.run/huge" }]);
  });

  it("skips BOM-only parts (labor never reaches the saw)", () => {
    const result = siteResult({
      a: instanceResult([part("labor.manufacturing", { geometry: undefined })]),
    });
    expect(buildCutList(result).components).toHaveLength(0);
  });
});

describe("buildWorkshopDrawing", () => {
  it("projects rotated pieces as quads and renders deviation flags (CORE_SPEC §6)", () => {
    const drawing = buildWorkshopDrawing(
      instanceResult([
        part("posts.end", {
          deviations: [
            { field: "lengthMm", original: 2000, value: 1950, overrideId: "ov1", reason: "kámen" },
          ],
        }),
      ]),
    );
    // Vertical post, width 60: x ∈ [-30, 30], y ∈ [0, 2000] — exactly.
    expect(drawing.bbox).toEqual({ min: { x: -30, y: 0 }, max: { x: 30, y: 2000 } });
    expect(drawing.dims.map((d) => [d.id, d.valueMm])).toEqual([
      ["overall.width", 60],
      ["overall.height", 2000],
    ]);
    expect(drawing.flags).toEqual([
      {
        partPath: "posts.end",
        field: "lengthMm",
        original: 2000,
        value: 1950,
        overrideId: "ov1",
        reason: "kámen",
      },
    ]);
  });
});

describe("buildSitePlan", () => {
  it("places outlines under poses and marks shared connections (I6)", () => {
    const result = siteResult(
      {
        a: instanceResult([part("posts.end")]),
        b: instanceResult([part("posts.start")]),
      },
      [
        {
          connection: 0,
          ownerInstanceId: "a",
          ownerPartPath: "posts.end",
          consumerInstanceId: "b",
          consumedPartPath: "posts.start",
        },
      ],
    );
    const plan = buildSitePlan(
      site(
        ["a", "b"],
        [{ a: { instanceId: "a", portId: "end" }, b: { instanceId: "b", portId: "start" } }],
      ),
      result,
    );
    expect(plan.instances.map((i) => i.instanceId)).toEqual(["a", "b"]);
    // Instance b sits at x=5000; its post footprint is centered there.
    expect(plan.instances[1]!.labelAt.x).toBe(5000);
    expect(plan.connections[0]!.shared).toEqual({
      ownerInstanceId: "a",
      partPath: "posts.end",
    });
    expect(plan.terrain).toEqual([{ id: "t1", elevationMm: 0, instanceIds: ["a", "b"] }]);
  });
});
