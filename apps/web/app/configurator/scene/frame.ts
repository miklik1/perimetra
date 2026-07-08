/**
 * Pure scene framing — world AABB + a camera pose that fits it. Uses the
 * renderers' exact arc-minute rotation (quarter turns stay integer-exact), so
 * the box matches what the walker draws; no three.js dependency, so it's unit
 * testable in plain jsdom/node.
 */
import { add, profileEnvelope, rotate, type Scene3D, type Vec3 } from "@repo/renderers";

export interface SceneFrame {
  center: Vec3;
  radius: number;
  cameraPosition: Vec3;
  /** World-space scene floor (AABB min Y) — where the studio `<ContactShadows>`
   *  plane sits so the gate is grounded, not floating (ADR 0074). */
  groundY: number;
  /** World AABB corners (pre-pad) — the section cut plane slides across these
   *  (ADR 0092). */
  min: Vec3;
  max: Vec3;
}

export function frameScene(scene: Scene3D): SceneFrame {
  // Two boxes: the AXIS box (piece centrelines) drives the camera fit + shadow
  // ground exactly as before; the SOLID box (axis box grown by each piece's
  // profile cross-section) drives the section cut (ADR 0092), so no axis is ever
  // degenerate — a planar gate keeps real depth for the Z cut to slide across.
  const aMin: Vec3 = [Infinity, Infinity, Infinity];
  const aMax: Vec3 = [-Infinity, -Infinity, -Infinity];
  const sMin: Vec3 = [Infinity, Infinity, Infinity];
  const sMax: Vec3 = [-Infinity, -Infinity, -Infinity];
  const grow = (lo: Vec3, hi: Vec3, p: Vec3, half: number) => {
    for (let i = 0; i < 3; i += 1) {
      lo[i] = Math.min(lo[i]!, p[i]! - half);
      hi[i] = Math.max(hi[i]!, p[i]! + half);
    }
  };

  for (const instance of scene.instances) {
    for (const piece of instance.pieces) {
      // Half the larger cross-section dimension. The real w/d come through
      // `profileEnvelope` (the SAME ProfileLibrary authority the drawing emitter
      // and the walker use — one envelope truth); only the box fallback (40mm →
      // ±20 for a profile-less or dimensionless piece) is presentation. The
      // section box is conservative (axis-aligned exact, a rotated profile within
      // a hair).
      let half = 20;
      if (piece.profile !== undefined) {
        const env = profileEnvelope(piece.profile);
        const w = env.halfW > 0 ? env.halfW * 2 : 40;
        const d = env.nominalDepth ? 40 : env.halfD * 2;
        half = Math.max(w, d) / 2;
      }
      const ends: Vec3[] = [
        piece.at,
        add(piece.at, rotate([piece.lengthMm, 0, 0], piece.rotationArcMin)),
      ];
      for (const end of ends) {
        const world = add(instance.at, rotate(end, instance.rotationArcMin));
        grow(aMin, aMax, world, 0);
        grow(sMin, sMax, world, half);
      }
    }
  }

  if (aMin[0] === Infinity) {
    return {
      center: [0, 1000, 0],
      radius: 3000,
      cameraPosition: [3000, 2500, 5000],
      groundY: 0,
      min: [-1500, 0, -1500],
      max: [1500, 2000, 1500],
    };
  }

  const pad = 150;
  const center: Vec3 = [(aMin[0] + aMax[0]) / 2, (aMin[1] + aMax[1]) / 2, (aMin[2] + aMax[2]) / 2];
  const radius =
    Math.hypot(aMax[0] - aMin[0] + pad, aMax[1] - aMin[1] + pad, aMax[2] - aMin[2] + pad) / 2;
  const cameraPosition: Vec3 = [
    center[0] + radius * 0.9,
    center[1] + radius * 0.8,
    center[2] + radius * 1.8,
  ];
  return { center, radius, cameraPosition, groundY: aMin[1], min: sMin, max: sMax };
}
