import { describe, expect, it } from "vitest";

import type { Scene3D } from "@repo/renderers";

import { frameScene } from "./frame";

/**
 * Pure scene framing (no three.js) — the world AABB + a camera pose, the same
 * jsdom-testable discipline as `profile-geometry.ts`. `groundY` (ADR 0074) is
 * the studio `<ContactShadows>` plane, so it must be the true scene floor.
 */
const ARCMIN_QUARTER = 5400; // 90° about Z: local +X (axis) → +Y (up).

function scene(): Scene3D {
  return {
    units: "mm",
    instances: [
      {
        instanceId: "i",
        releaseId: "r@1",
        at: [0, 0, 0],
        rotationArcMin: [0, 0, 0],
        pieces: [
          // Horizontal bar at y=500, spanning x∈[0,2000].
          {
            id: "bar",
            componentCode: "rail",
            name: "rail",
            lengthMm: 2000,
            at: [0, 500, 0],
            rotationArcMin: [0, 0, 0],
          },
          // Vertical post rooted at y=0, rising 1000 (quarter-turn about Z).
          {
            id: "post",
            componentCode: "post",
            name: "post",
            lengthMm: 1000,
            at: [0, 0, 0],
            rotationArcMin: [0, 0, ARCMIN_QUARTER],
          },
        ],
      },
    ],
  };
}

describe("frameScene", () => {
  it("grounds at the AABB floor and centers on the world box", () => {
    const f = frameScene(scene());
    // World AABB x∈[0,2000], y∈[0,1000], z=0 (quarter turns are integer-exact).
    expect(f.groundY).toBe(0);
    expect(f.center).toEqual([1000, 500, 0]);
    expect(f.cameraPosition[1]).toBeGreaterThan(f.center[1]!); // camera looks down
    expect(f.radius).toBeGreaterThan(1000);
    expect(f.radius).toBeLessThan(1400);
  });

  it("falls back to a sane pose (groundY 0) for an empty scene", () => {
    const f = frameScene({ units: "mm", instances: [] });
    expect(f.groundY).toBe(0);
    expect(f.center).toEqual([0, 1000, 0]);
    expect(f.radius).toBe(3000);
  });
});
