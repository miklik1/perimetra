import { Box3, Vector3 } from "three";
import { afterEach, describe, expect, it } from "vitest";

import type { PieceProfile } from "@repo/engine";

import {
  _clearGeometryCache,
  _geometryCacheSize,
  buildPieceGeometry,
  buildProfileShape,
} from "./profile-geometry";

/**
 * Procedural profile extrusion (ADR 0073) — the shape/geometry math is pure CPU
 * (THREE builds vertex buffers without WebGL), so it proves out in jsdom the
 * same way `frame.ts` does. The R3F walker that attaches these is not tested
 * here (no WebGL), only that the geometry it would attach is correctly shaped.
 */
afterEach(() => _clearGeometryCache());

const jakl60: PieceProfile = { shape: "rect_tube", wMm: 60, dMm: 60 };

function bbox(geometry: { computeBoundingBox: () => void; boundingBox: Box3 | null }) {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox ?? new Box3();
  const size = box.getSize(new Vector3());
  return { box, size };
}

describe("buildProfileShape", () => {
  it("rect_tube renders SOLID when the catalog gives no wall (never invents one)", () => {
    const shape = buildProfileShape(jakl60);
    expect(shape).not.toBeNull();
    expect(shape!.holes).toHaveLength(0);
  });

  it("rect_tube renders HOLLOW when a real wall is present", () => {
    const shape = buildProfileShape({ shape: "rect_tube", wMm: 60, dMm: 60, wallMm: 3 });
    expect(shape!.holes).toHaveLength(1);
  });

  it("flat defaults to a THIN plank section (width preserved, depth slim)", () => {
    const shape = buildProfileShape({ shape: "flat", wMm: 100 });
    expect(shape).not.toBeNull();
    const pts = shape!.extractPoints(1).shape;
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    // width (Y) = 100 → ±50; depth (X) defaults thin = 20 → ±10.
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(100, 5);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(20, 5);
  });

  it("models L/U/T silhouettes and returns null for custom (box fallback)", () => {
    expect(buildProfileShape({ shape: "L", wMm: 50, dMm: 50 })).not.toBeNull();
    expect(buildProfileShape({ shape: "U", wMm: 50, dMm: 50 })).not.toBeNull();
    expect(buildProfileShape({ shape: "T", wMm: 50, dMm: 50 })).not.toBeNull();
    expect(buildProfileShape({ shape: "custom", wMm: 50 })).toBeNull();
  });
});

describe("buildPieceGeometry", () => {
  it("extrudes along local-X with the cross-section centered on the axis", () => {
    const geometry = buildPieceGeometry(jakl60, 2000)!;
    expect(geometry).not.toBeNull();
    const { box } = bbox(geometry);
    // Origin at the axis start, span [0, length] (± the sub-mm bevel overhang).
    expect(box.min.x).toBeGreaterThan(-1);
    expect(box.min.x).toBeLessThan(1);
    expect(box.max.x).toBeGreaterThan(2000);
    expect(box.max.x).toBeLessThan(2002);
    // Cross-section 60×60 centered → ±30 on Y (width) and Z (depth), plus the
    // sub-mm outward bevel lip.
    expect(box.max.y).toBeGreaterThan(30);
    expect(box.max.y).toBeLessThan(31);
    expect(box.min.y).toBeCloseTo(-box.max.y, 5);
    expect(box.max.z).toBeGreaterThan(30);
    expect(box.max.z).toBeLessThan(31);
    expect(box.min.z).toBeCloseTo(-box.max.z, 5);
  });

  it("a thin flat plank keeps its broad face on Y, thin on Z", () => {
    const { box } = bbox(buildPieceGeometry({ shape: "flat", wMm: 100 }, 1000)!);
    expect(box.max.x).toBeGreaterThan(1000);
    expect(box.max.x).toBeLessThan(1002);
    expect(box.max.y).toBeGreaterThan(50); // width 100 → ±50 (+ bevel)
    expect(box.max.y).toBeLessThan(51);
    expect(box.max.z).toBeGreaterThan(10); // thin 20 → ±10 (+ bevel)
    expect(box.max.z).toBeLessThan(11);
  });

  it("shares one cached buffer across identical (shape, dims, length)", () => {
    const a = buildPieceGeometry(jakl60, 2000);
    const b = buildPieceGeometry({ shape: "rect_tube", wMm: 60, dMm: 60 }, 2000);
    expect(a).toBe(b);
    expect(_geometryCacheSize()).toBe(1);
    const c = buildPieceGeometry(jakl60, 1800); // different length → distinct
    expect(c).not.toBe(a);
    expect(_geometryCacheSize()).toBe(2);
  });

  it("returns null for no profile or a zero length (caller draws the box)", () => {
    expect(buildPieceGeometry(undefined, 2000)).toBeNull();
    expect(buildPieceGeometry(jakl60, 0)).toBeNull();
    expect(buildPieceGeometry({ shape: "custom" }, 2000)).toBeNull();
  });
});
