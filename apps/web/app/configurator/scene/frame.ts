/**
 * Pure scene framing — world AABB + a camera pose that fits it. Uses the
 * renderers' exact arc-minute rotation (quarter turns stay integer-exact), so
 * the box matches what the walker draws; no three.js dependency, so it's unit
 * testable in plain jsdom/node.
 */
import { add, rotate, type Scene3D, type Vec3 } from "@repo/renderers";

export interface SceneFrame {
  center: Vec3;
  radius: number;
  cameraPosition: Vec3;
}

export function frameScene(scene: Scene3D): SceneFrame {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  const grow = (p: Vec3) => {
    for (let i = 0; i < 3; i += 1) {
      min[i] = Math.min(min[i]!, p[i]!);
      max[i] = Math.max(max[i]!, p[i]!);
    }
  };

  for (const instance of scene.instances) {
    for (const piece of instance.pieces) {
      // Piece axis endpoints through piece + instance transforms (the
      // cross-section pad below covers profile thickness).
      const ends: Vec3[] = [
        piece.at,
        add(piece.at, rotate([piece.lengthMm, 0, 0], piece.rotationArcMin)),
      ];
      for (const end of ends) grow(add(instance.at, rotate(end, instance.rotationArcMin)));
    }
  }

  if (min[0] === Infinity) {
    return { center: [0, 1000, 0], radius: 3000, cameraPosition: [3000, 2500, 5000] };
  }

  const pad = 150;
  const center: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const radius =
    Math.hypot(max[0] - min[0] + pad, max[1] - min[1] + pad, max[2] - min[2] + pad) / 2;
  const cameraPosition: Vec3 = [
    center[0] + radius * 0.9,
    center[1] + radius * 0.8,
    center[2] + radius * 1.8,
  ];
  return { center, radius, cameraPosition };
}
