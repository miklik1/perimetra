import { describe, expect, it } from "vitest";

import type { Scene3D, Vec3 } from "@repo/renderers";

import { DEFAULT_EXPLODE_SPREAD, explodedPosition, pieceExplodeOffsets } from "./explode-offsets";

const ARCMIN_QUARTER = 5400;

/** A single-instance scene whose pieces lie on the X axis at the given origins
 *  (length 1000, unrotated → each midpoint is origin + [500,0,0]). */
function lineScene(origins: Vec3[]): Scene3D {
  return {
    units: "mm",
    instances: [
      {
        instanceId: "i0",
        releaseId: "r@1",
        at: [0, 0, 0],
        rotationArcMin: [0, 0, 0],
        pieces: origins.map((at, i) => ({
          id: `i0/part/${i}`,
          componentCode: "c",
          name: "P",
          lengthMm: 1000,
          at,
          rotationArcMin: [0, 0, 0] as Vec3,
        })),
      },
    ],
  };
}

describe("pieceExplodeOffsets", () => {
  it("blooms each piece away from the instance centroid (equal-and-opposite, sums to zero)", () => {
    // mids: [500,0,0] and [1500,0,0] → centroid [1000,0,0].
    const offsets = pieceExplodeOffsets(
      lineScene([
        [0, 0, 0],
        [1000, 0, 0],
      ]),
      1,
    );
    expect(offsets.get("i0/part/0")).toEqual([-500, 0, 0]);
    expect(offsets.get("i0/part/1")).toEqual([500, 0, 0]);
    const sum = [...offsets.values()].reduce(
      (acc, o) => [acc[0] + o[0], acc[1] + o[1], acc[2] + o[2]],
      [0, 0, 0],
    );
    expect(sum).toEqual([0, 0, 0]);
  });

  it("scales the displacement linearly with the spread factor", () => {
    const offsets = pieceExplodeOffsets(
      lineScene([
        [0, 0, 0],
        [1000, 0, 0],
      ]),
      0.5,
    );
    expect(offsets.get("i0/part/0")).toEqual([-250, 0, 0]);
    expect(offsets.get("i0/part/1")).toEqual([250, 0, 0]);
  });

  it("leaves a piece sitting on the centroid in place", () => {
    // mids: -500, 0, +500 → centroid 0; the middle piece has zero offset.
    const offsets = pieceExplodeOffsets(
      lineScene([
        [-1000, 0, 0],
        [-500, 0, 0],
        [0, 0, 0],
      ]),
      1,
    );
    expect(offsets.get("i0/part/1")).toEqual([0, 0, 0]);
    expect(offsets.get("i0/part/0")).toEqual([-500, 0, 0]);
    expect(offsets.get("i0/part/2")).toEqual([500, 0, 0]);
  });

  it("uses each piece's rotated axis midpoint (instance-local)", () => {
    // One vertical piece (rotated +90° about Z): mid = at + rotate([500,0,0]) = at + [0,500,0].
    const scene: Scene3D = {
      units: "mm",
      instances: [
        {
          instanceId: "i0",
          releaseId: "r@1",
          at: [0, 0, 0],
          rotationArcMin: [0, 0, 0],
          pieces: [
            {
              id: "i0/post/0",
              componentCode: "c",
              name: "post",
              lengthMm: 1000,
              at: [0, 0, 0],
              rotationArcMin: [0, 0, ARCMIN_QUARTER],
            },
            {
              id: "i0/post/1",
              componentCode: "c",
              name: "post",
              lengthMm: 1000,
              at: [0, 2000, 0],
              rotationArcMin: [0, 0, ARCMIN_QUARTER],
            },
          ],
        },
      ],
    };
    // mids: [0,500,0] and [0,2500,0] → centroid [0,1500,0].
    const offsets = pieceExplodeOffsets(scene, 1);
    expect(offsets.get("i0/post/0")).toEqual([0, -1000, 0]);
    expect(offsets.get("i0/post/1")).toEqual([0, 1000, 0]);
  });

  it("emits nothing for an empty instance and a zero offset for a lone piece", () => {
    expect(pieceExplodeOffsets({ units: "mm", instances: [] }).size).toBe(0);
    const lone = pieceExplodeOffsets(lineScene([[0, 0, 0]]), 1);
    expect(lone.get("i0/part/0")).toEqual([0, 0, 0]);
  });

  it("defaults to DEFAULT_EXPLODE_SPREAD when the spread is omitted", () => {
    const scene = lineScene([
      [0, 0, 0],
      [1000, 0, 0],
    ]);
    expect([...pieceExplodeOffsets(scene).entries()]).toEqual([
      ...pieceExplodeOffsets(scene, DEFAULT_EXPLODE_SPREAD).entries(),
    ]);
  });

  it("is deterministic", () => {
    const a = pieceExplodeOffsets(
      lineScene([
        [0, 0, 0],
        [1000, 0, 0],
        [3000, 0, 0],
      ]),
    );
    const b = pieceExplodeOffsets(
      lineScene([
        [0, 0, 0],
        [1000, 0, 0],
        [3000, 0, 0],
      ]),
    );
    expect([...a.entries()]).toEqual([...b.entries()]);
  });
});

describe("explodedPosition", () => {
  const at: Vec3 = [100, 200, 300];
  const offset: Vec3 = [10, -20, 30];

  it("returns the assembled origin at factor 0", () => {
    expect(explodedPosition(at, offset, 0)).toEqual(at);
  });

  it("applies the full offset at factor 1", () => {
    expect(explodedPosition(at, offset, 1)).toEqual([110, 180, 330]);
  });

  it("interpolates linearly", () => {
    expect(explodedPosition(at, offset, 0.5)).toEqual([105, 190, 315]);
  });

  it("is a no-op when the piece has no offset", () => {
    expect(explodedPosition(at, undefined, 1)).toEqual(at);
  });
});
