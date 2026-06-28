import { describe, expect, it } from "vitest";

import type { Scene3D, Vec3 } from "@repo/renderers";

import { deviatedPieceCenters, placeEdgeMarker } from "./deviation-markers";

const ARCMIN_QUARTER = 5400;

function sceneWith(deviatedIds: string[]): Scene3D {
  return {
    units: "mm",
    instances: [
      {
        instanceId: "i0",
        releaseId: "r@1",
        at: [0, 0, 0],
        rotationArcMin: [0, 0, 0],
        pieces: [
          {
            id: "a",
            componentCode: "c",
            name: "A",
            lengthMm: 1000,
            at: [500, 0, 0],
            rotationArcMin: [0, 0, 0],
            ...(deviatedIds.includes("a") && { deviated: true }),
          },
          {
            id: "b",
            componentCode: "c",
            name: "B",
            lengthMm: 2000,
            at: [0, 0, 0],
            rotationArcMin: [0, 0, ARCMIN_QUARTER],
            ...(deviatedIds.includes("b") && { deviated: true }),
          },
        ],
      },
    ],
  };
}

describe("deviatedPieceCenters", () => {
  it("returns nothing when no piece is deviated", () => {
    expect(deviatedPieceCenters(sceneWith([]))).toEqual([]);
  });

  it("returns the axis-midpoint world centre of each deviated piece", () => {
    // Piece 'a': origin [500,0,0], length 1000 along +X → midpoint [1000,0,0].
    expect(deviatedPieceCenters(sceneWith(["a"]))).toEqual([[1000, 0, 0]]);
  });

  it("applies the piece rotation to the midpoint (vertical piece rises in Y)", () => {
    // Piece 'b': origin [0,0,0], length 2000, rotated +90° about Z → axis points
    // +Y, so the midpoint is [0,1000,0] (within float tolerance).
    const [center] = deviatedPieceCenters(sceneWith(["b"]));
    expect(center![0]).toBeCloseTo(0, 6);
    expect(center![1]).toBeCloseTo(1000, 6);
    expect(center![2]).toBeCloseTo(0, 6);
  });

  it("collects every deviated piece", () => {
    expect(deviatedPieceCenters(sceneWith(["a", "b"]))).toHaveLength(2);
  });

  it("shifts the centre by an explode offset so the §6 marker tracks the bloom", () => {
    // Piece 'a' assembled centre is [1000,0,0]; with the instance unrotated the
    // bloom offset adds straight through.
    const offsets = new Map<string, Vec3>([["a", [50, -30, 20]]]);
    expect(deviatedPieceCenters(sceneWith(["a"]), offsets)).toEqual([[1050, -30, 20]]);
  });
});

describe("placeEdgeMarker", () => {
  const W = 800;
  const H = 600;

  it("is on-screen for a centred point and maps to the viewport centre", () => {
    const p = placeEdgeMarker({ x: 0, y: 0, z: 0 }, W, H);
    expect(p.offscreen).toBe(false);
    expect(p.px).toBeCloseTo(W / 2);
    expect(p.py).toBeCloseTo(H / 2);
  });

  it("is on-screen anywhere inside the [-1,1] NDC box", () => {
    expect(placeEdgeMarker({ x: 0.99, y: -0.99, z: 0.5 }, W, H).offscreen).toBe(false);
  });

  it("flags a point past the right edge as off-screen and clamps it inside the viewport", () => {
    const p = placeEdgeMarker({ x: 2.5, y: 0, z: 0.5 }, W, H);
    expect(p.offscreen).toBe(true);
    expect(p.px).toBeGreaterThanOrEqual(0);
    expect(p.px).toBeLessThanOrEqual(W);
    expect(p.py).toBeGreaterThanOrEqual(0);
    expect(p.py).toBeLessThanOrEqual(H);
    // Clamped to the right margin ring, not off the edge.
    expect(p.px).toBeGreaterThan(W / 2);
  });

  it("treats a point BEHIND the camera (z > 1) as off-screen (§6 — no angle hides it)", () => {
    const p = placeEdgeMarker({ x: 0.1, y: 0.1, z: 1.5 }, W, H);
    expect(p.offscreen).toBe(true);
    expect(p.px).toBeGreaterThanOrEqual(0);
    expect(p.px).toBeLessThanOrEqual(W);
  });
});
