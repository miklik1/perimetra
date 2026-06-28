/**
 * Exploded-view displacement — the PURE half (ADR 0091). An exploded view is
 * pure PRESENTATION: it never touches the engine, the release, or the BOM/price
 * (I1/I4), so — exactly like the finish and deviation slices — it lives entirely
 * in app-land and is a deterministic transform of the already-derived `Scene3D`.
 * No three.js, no React, so the geometry is unit-testable in plain node.
 *
 * The rule is a linear "bloom": every piece slides away from its instance's
 * piece-cloud centroid along the line through its own axis midpoint. Perimeter
 * pieces (frame rails, posts) travel far; central pieces (infill near the middle)
 * barely move — so the original arrangement stays legible while the assembly
 * opens up. The midpoint convention matches `deviation-markers.ts` exactly
 * (instance-local `at` + the rotated half-length), so a deviated piece's edge
 * marker tracks the bloomed position with no drift (the §6 guarantee holds
 * through the explode — see `scene-canvas.tsx`).
 *
 * Returned offsets are the displacement at FULL explode (factor = 1); the
 * renderer scales them by the live 0→1 factor (`explodedPosition`). The spread
 * constant is taste, calibrated against Martin's eye in the render pass — it is
 * structure here, not a frozen value.
 */
import { add, rotate, type Scene3D, type Vec3 } from "@repo/renderers";

/** How far the bloom throws a piece, as a fraction of its distance from the
 *  centroid (1 = the piece doubles its distance from centre at full explode). */
export const DEFAULT_EXPLODE_SPREAD = 0.85;

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scaleVec = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];

/** Instance-local axis midpoint of a piece (origin + rotated half-length). */
function pieceMid(at: Vec3, rotationArcMin: Vec3, lengthMm: number): Vec3 {
  return add(at, rotate([lengthMm / 2, 0, 0], rotationArcMin));
}

/**
 * `Map<pieceId, displacement-at-factor-1>` — each piece's full bloom offset in
 * instance-local space. A lone piece (or one sitting on the centroid) gets a
 * zero offset; an empty instance contributes nothing.
 */
export function pieceExplodeOffsets(
  scene: Scene3D,
  spread = DEFAULT_EXPLODE_SPREAD,
): Map<string, Vec3> {
  const out = new Map<string, Vec3>();
  for (const instance of scene.instances) {
    const n = instance.pieces.length;
    if (n === 0) continue;
    const mids = instance.pieces.map((p) => pieceMid(p.at, p.rotationArcMin, p.lengthMm));
    const centroid: Vec3 = [0, 0, 0];
    for (const m of mids) {
      centroid[0] += m[0] / n;
      centroid[1] += m[1] / n;
      centroid[2] += m[2] / n;
    }
    instance.pieces.forEach((piece, i) => {
      out.set(piece.id, scaleVec(sub(mids[i]!, centroid), spread));
    });
  }
  return out;
}

/**
 * The assembled origin pushed toward its full bloom offset by the live factor
 * (0 = assembled, 1 = fully exploded). Linear, so a deviated piece's world
 * centre stays a straight lerp between assembled and bloomed (§6 tracking).
 */
export function explodedPosition(at: Vec3, offset: Vec3 | undefined, factor: number): Vec3 {
  if (offset === undefined || factor === 0) return at;
  return [at[0] + offset[0] * factor, at[1] + offset[1] * factor, at[2] + offset[2] * factor];
}
