import { describe, expect, it } from "vitest";

import type { Vec3 } from "@repo/renderers";

import { cameraPose } from "./camera-poses";
import type { SceneFrame } from "./frame";

const frame: SceneFrame = {
  center: [1000, 750, 0],
  radius: 2000,
  cameraPosition: [2800, 2350, 3600],
  groundY: 0,
};

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (v: Vec3): number => Math.hypot(v[0], v[1], v[2]);

describe("cameraPose", () => {
  it("hero is the AABB-fit pose looking at the centre", () => {
    const p = cameraPose("hero", frame);
    expect(p.position).toEqual(frame.cameraPosition);
    expect(p.target).toEqual(frame.center);
  });

  it("front is a near-straight-on elevation (aligned in x, pulled out on z)", () => {
    const p = cameraPose("front", frame);
    expect(p.position[0]).toBeCloseTo(frame.center[0]);
    expect(p.position[2]).toBeGreaterThan(frame.center[2] + frame.radius);
    expect(p.target).toEqual(frame.center);
  });

  it("pullback sits further out than detail (the Summary reveal)", () => {
    const detail = len(sub(cameraPose("detail", frame).position, frame.center));
    const pullback = len(sub(cameraPose("pullback", frame).position, frame.center));
    expect(pullback).toBeGreaterThan(detail);
  });

  it("away looks AWAY from the scene — the target is the position reflected past the centre", () => {
    const p = cameraPose("away", frame);
    const toCamera = sub(p.position, frame.center);
    const toTarget = sub(p.target, frame.center);
    // Same direction (positive parallel), target strictly further → camera faces
    // away from the centre, so the scene is behind the frustum (§6 e2e).
    const dot = toCamera[0] * toTarget[0] + toCamera[1] * toTarget[1] + toCamera[2] * toTarget[2];
    expect(dot).toBeGreaterThan(0);
    expect(len(toTarget)).toBeGreaterThan(len(toCamera));
  });
});
