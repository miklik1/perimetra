import { describe, expect, it } from "vitest";

import type { Vec3 } from "@repo/renderers";

import type { SceneFrame } from "./frame";
import { sectionPlane } from "./section-plane";

const frame: SceneFrame = {
  center: [1000, 500, 0],
  radius: 1200,
  cameraPosition: [0, 0, 0],
  groundY: 0,
  min: [0, 0, -100],
  max: [2000, 1000, 100],
};

/** three.js keeps a pixel where normal·point + constant >= 0. */
const keeps = (n: Vec3, c: number, p: Vec3): boolean =>
  n[0] * p[0] + n[1] * p[1] + n[2] * p[2] + c >= 0;

describe("sectionPlane", () => {
  it("cuts the X axis at the position-interpolated coordinate, keeping the lower half", () => {
    const { normal, constant } = sectionPlane(frame, "x", 0.5);
    // Cut at x = 1000 (midpoint of [0,2000]); inward normal points to -X.
    expect(normal).toEqual([-1, 0, 0]);
    expect(constant).toBe(1000);
    expect(keeps(normal, constant, [500, 500, 0])).toBe(true); // x < cut → kept
    expect(keeps(normal, constant, [1500, 500, 0])).toBe(false); // x > cut → clipped
  });

  it("cuts the Y axis", () => {
    const { normal, constant } = sectionPlane(frame, "y", 0.25);
    expect(normal).toEqual([0, -1, 0]);
    expect(constant).toBe(250); // 0 + 0.25 * 1000
  });

  it("cuts the Z axis", () => {
    const { normal, constant } = sectionPlane(frame, "z", 0.5);
    expect(normal).toEqual([0, 0, -1]);
    expect(constant).toBe(0); // midpoint of [-100,100]
  });

  it("position 0 cuts at the axis minimum, 1 at the maximum", () => {
    expect(sectionPlane(frame, "x", 0).constant).toBe(0);
    expect(sectionPlane(frame, "x", 1).constant).toBe(2000);
  });

  it("clamps the position to [0,1]", () => {
    expect(sectionPlane(frame, "x", -2).constant).toBe(0);
    expect(sectionPlane(frame, "x", 5).constant).toBe(2000);
  });
});
