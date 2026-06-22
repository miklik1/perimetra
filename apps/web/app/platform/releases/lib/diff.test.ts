/**
 * Structural release diff (ADR 0068 Phase 3D) — keyed by business key
 * (parameters/constraints/derived by key, parts by path), islands compared
 * whole, the version bump reported separately from content.
 */
import { describe, expect, it } from "vitest";

import { expr, type ProductModelRelease } from "@repo/model";

import { deepEqual, diffRelease } from "./diff";

function base(): ProductModelRelease {
  return {
    id: "g@1",
    modelId: "g",
    version: 1,
    status: "published",
    parameters: [
      { key: "w", type: "length_mm", adjustability: "user", default: 1000 },
      { key: "h", type: "length_mm", adjustability: "user", default: 2000 },
    ],
    constraints: [
      { key: "c1", kind: "expr", expr: expr("w > 0"), severity: "error", scope: "instance" },
    ],
    derivation: {
      derived: [{ key: "d1", expr: expr("w * 2") }],
      parts: [
        {
          path: "p1",
          name: "P1",
          resolve: { role: "r" },
          bom: { unit: "piece", quantity: expr("1"), category: "material" },
        },
      ],
    },
    terrain: { elevationParam: "w" },
  };
}

describe("diffRelease", () => {
  it("reports no content change for an identical release", () => {
    const d = diffRelease(base(), base());
    expect(d.hasChanges).toBe(false);
    expect(d.versionChanged).toBe(false);
    expect(d.sections).toEqual([]);
    expect(d.islandsChanged).toEqual([]);
  });

  it("detects added / removed / changed by business key", () => {
    const current = base();
    current.parameters = [
      { key: "w", type: "length_mm", adjustability: "user", default: 1500 }, // changed
      { key: "depth", type: "length_mm", adjustability: "user", default: 50 }, // added
      // "h" removed
    ];
    const d = diffRelease(base(), current);
    const params = d.sections.find((s) => s.section === "parameters")!;
    expect(params.changed).toEqual(["w"]);
    expect(params.added).toEqual(["depth"]);
    expect(params.removed).toEqual(["h"]);
    expect(d.hasChanges).toBe(true);
  });

  it("detects a changed part (deep, e.g. BOM) and an island change", () => {
    const current = base();
    current.derivation.parts[0]!.bom.quantity = expr("2");
    current.terrain = { elevationParam: "h" };
    const d = diffRelease(base(), current);
    expect(d.sections.find((s) => s.section === "parts")!.changed).toEqual(["p1"]);
    expect(d.islandsChanged).toContain("terrain");
  });

  it("flags the version bump separately from content", () => {
    const current = base();
    current.version = 2;
    current.id = "g@2";
    const d = diffRelease(base(), current);
    expect(d.versionChanged).toBe(true);
    expect(d.baseVersion).toBe(1);
    expect(d.currentVersion).toBe(2);
    expect(d.hasChanges).toBe(false); // a bump alone is not a content change
  });
});

describe("deepEqual", () => {
  it("is order-insensitive on objects, strict on array order, distinguishes absent vs undefined", () => {
    expect(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(deepEqual([1, 2], [2, 1])).toBe(false);
    expect(deepEqual({ a: undefined }, {})).toBe(false);
  });
});
