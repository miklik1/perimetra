import { describe, expect, it } from "vitest";

import type { Scene3D, Vec3 } from "@repo/renderers";

import { DEFAULT_EXPLODE_SPREAD, explodedPosition, pieceExplodeOffsets } from "./explode-offsets";

/** A single-instance scene; each entry is `[partKey, midX, midY, midZ]` — the
 *  piece is unrotated length 1000, so `at = mid - [500,0,0]`. The id encodes the
 *  part so pieces sharing a `partKey` are one part. */
function scene(pieces: [string, number, number, number][]): Scene3D {
  return {
    units: "mm",
    instances: [
      {
        instanceId: "i0",
        releaseId: "r@1",
        at: [0, 0, 0],
        rotationArcMin: [0, 0, 0],
        pieces: pieces.map(([part, mx, my, mz], i) => ({
          id: `i0/${part}/${i}`,
          componentCode: "c",
          name: part,
          lengthMm: 1000,
          at: [mx - 500, my, mz] as Vec3,
          rotationArcMin: [0, 0, 0] as Vec3,
        })),
      },
    ],
  };
}

describe("pieceExplodeOffsets", () => {
  it("moves each PART rigidly — every piece of a part shares one offset (no per-piece scatter)", () => {
    // Parts: frame (two pieces, centroid [-1000,1000,0]) + lock (one piece,
    // [2000,1000,0]). Assembly centroid = [0,1000,0].
    const offsets = pieceExplodeOffsets(
      scene([
        ["frame", -1000, 0, 0],
        ["frame", -1000, 2000, 0],
        ["lock", 2000, 1000, 0],
      ]),
      1,
    );
    // Both frame pieces get the SAME offset (the part travels as a unit).
    expect(offsets.get("i0/frame/0")).toEqual([-1000, 0, 0]);
    expect(offsets.get("i0/frame/1")).toEqual([-1000, 0, 0]);
    expect(offsets.get("i0/lock/2")).toEqual([2000, 0, 0]);
  });

  it("blooms parts away from the assembly centroid, summing to zero", () => {
    const offsets = pieceExplodeOffsets(
      scene([
        ["left", 500, 0, 0],
        ["right", 2500, 0, 0],
      ]),
      1,
    );
    // Centroid [1500,0,0]; the two single-piece parts move equal-and-opposite.
    expect(offsets.get("i0/left/0")).toEqual([-1000, 0, 0]);
    expect(offsets.get("i0/right/1")).toEqual([1000, 0, 0]);
    const sum = [...offsets.values()].reduce(
      (a, o) => [a[0] + o[0], a[1] + o[1], a[2] + o[2]],
      [0, 0, 0],
    );
    expect(sum).toEqual([0, 0, 0]);
  });

  it("does NOT explode a single-part assembly (nothing to separate)", () => {
    const offsets = pieceExplodeOffsets(
      scene([
        ["frame", 0, 0, 0],
        ["frame", 1000, 0, 0],
        ["frame", 2000, 0, 0],
      ]),
      1,
    );
    for (const o of offsets.values()) expect(o).toEqual([0, 0, 0]);
  });

  it("treats distinct part paths (dots/brackets) as distinct parts", () => {
    const offsets = pieceExplodeOffsets(
      scene([
        ["frame.post[left]", 0, 0, 0],
        ["frame.rail[top]", 2000, 0, 0],
      ]),
      1,
    );
    expect(offsets.get("i0/frame.post[left]/0")).toEqual([-1000, 0, 0]);
    expect(offsets.get("i0/frame.rail[top]/1")).toEqual([1000, 0, 0]);
  });

  it("scales the displacement linearly with the spread factor", () => {
    const offsets = pieceExplodeOffsets(
      scene([
        ["left", 500, 0, 0],
        ["right", 2500, 0, 0],
      ]),
      0.5,
    );
    expect(offsets.get("i0/left/0")).toEqual([-500, 0, 0]);
    expect(offsets.get("i0/right/1")).toEqual([500, 0, 0]);
  });

  it("defaults to DEFAULT_EXPLODE_SPREAD when the spread is omitted", () => {
    const s = scene([
      ["left", 500, 0, 0],
      ["right", 2500, 0, 0],
    ]);
    expect([...pieceExplodeOffsets(s).entries()]).toEqual([
      ...pieceExplodeOffsets(s, DEFAULT_EXPLODE_SPREAD).entries(),
    ]);
  });

  it("emits nothing for an empty instance", () => {
    expect(pieceExplodeOffsets({ units: "mm", instances: [] }).size).toBe(0);
  });

  it("is deterministic", () => {
    const s = scene([
      ["a", 0, 0, 0],
      ["b", 1000, 0, 0],
      ["c", 3000, 0, 0],
    ]);
    expect([...pieceExplodeOffsets(s).entries()]).toEqual([...pieceExplodeOffsets(s).entries()]);
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
