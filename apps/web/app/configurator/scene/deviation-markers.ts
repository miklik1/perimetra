/**
 * The out-of-frustum deviation guarantee (ADR 0076, CORE_SPEC §6) — the PURE
 * half: where a deviated piece is in the world, and where its edge-marker sits
 * once projected. No three.js, no WebGL, no React — so the §6 guarantee
 * ("no camera angle can hide a deviated piece") is unit-testable in plain node.
 * The R3F side (`scene-canvas.tsx`) only does the per-frame `vec3.project(camera)`
 * and feeds the result here.
 */
import { add, rotate, type Scene3D, type Vec3 } from "@repo/renderers";

/** World-space centre of every deviated piece in the scene (instance pose ∘
 *  piece pose ∘ axis midpoint) — the points the edge markers track. Matches the
 *  exact arc-minute trig the walker draws with, so a marker points where the
 *  piece actually is.
 *
 *  `offsets` (ADR 0091) shifts each piece's instance-local origin by its FULL
 *  explode displacement, so passing the bloom map yields the centres at full
 *  explode. The world centre is linear in the explode factor, so the projector
 *  lerps between the assembled (no offsets) and bloomed (with offsets) centres —
 *  the §6 guarantee holds through the explode, with no marker drift. */
export function deviatedPieceCenters(scene: Scene3D, offsets?: Map<string, Vec3>): Vec3[] {
  const centers: Vec3[] = [];
  for (const instance of scene.instances) {
    for (const piece of instance.pieces) {
      if (piece.deviated !== true) continue;
      const mid = add(piece.at, rotate([piece.lengthMm / 2, 0, 0], piece.rotationArcMin));
      const off = offsets?.get(piece.id);
      const local = off === undefined ? mid : add(mid, off);
      centers.push(add(instance.at, rotate(local, instance.rotationArcMin)));
    }
  }
  return centers;
}

export interface NdcPoint {
  /** Normalised device coords from `vector.project(camera)` — on-screen is
   *  [-1,1]² with z ≤ 1; z > 1 means the point is BEHIND the camera. */
  x: number;
  y: number;
  z: number;
}

export interface MarkerPlacement {
  /** True when the piece is outside the frustum (or behind the camera) — only
   *  then is a marker shown. */
  offscreen: boolean;
  /** Pixel position from the viewport top-left where the marker sits (clamped to
   *  the edge ring when off-screen, the true projection when on-screen). */
  px: number;
  py: number;
}

/**
 * Decide whether a projected point needs an edge marker and where it goes.
 * Off-screen → clamp the direction to a margin ring so the marker rides the
 * viewport edge pointing at the piece (so no angle can hide it). A point behind
 * the camera projects mirrored, so flip it before clamping.
 */
export function placeEdgeMarker(
  ndc: NdcPoint,
  width: number,
  height: number,
  margin = 0.9,
): MarkerPlacement {
  const behind = ndc.z > 1;
  let x = ndc.x;
  let y = ndc.y;
  if (behind) {
    x = -x;
    y = -y;
  }
  const offscreen = behind || x < -1 || x > 1 || y < -1 || y > 1;
  const toPx = (nx: number, ny: number): { px: number; py: number } => ({
    px: (nx * 0.5 + 0.5) * width,
    py: (-ny * 0.5 + 0.5) * height,
  });
  if (!offscreen) return { offscreen: false, ...toPx(x, y) };
  const mag = Math.max(Math.abs(x), Math.abs(y)) || 1;
  return { offscreen: true, ...toPx((x / mag) * margin, (y / mag) * margin) };
}
