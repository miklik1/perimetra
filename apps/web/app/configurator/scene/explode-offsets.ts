/**
 * Exploded-view displacement — the PURE half (ADR 0091). An exploded view is
 * pure PRESENTATION: it never touches the engine, the release, or the BOM/price
 * (I1/I4), so — exactly like the finish and deviation slices — it lives entirely
 * in app-land and is a deterministic transform of the already-derived `Scene3D`.
 * No three.js, no React, so the geometry is unit-testable in plain node.
 *
 * The rule is a linear "bloom" BY PART: each part (all the pieces sharing a
 * partPath) slides AS A RIGID UNIT away from the instance's centroid, along the
 * line through the part's own centroid. Grouping is what makes it read as an
 * exploded ASSEMBLY rather than a per-piece scatter — the four bars of a frame
 * travel together, the infill travels together, the lock travels together;
 * perimeter parts travel far, central parts barely move, so the arrangement
 * stays legible. The midpoint convention matches `deviation-markers.ts` exactly
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

/** How far the bloom throws a part, as a fraction of its distance from the
 *  centroid (1 = the part doubles its distance from centre at full explode). */
export const DEFAULT_EXPLODE_SPREAD = 0.85;

const scaleVec = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];

/** Instance-local axis midpoint of a piece (origin + rotated half-length). */
function pieceMid(at: Vec3, rotationArcMin: Vec3, lengthMm: number): Vec3 {
  return add(at, rotate([lengthMm / 2, 0, 0], rotationArcMin));
}

/** The part address inside a piece id `<instanceId>/<partPath>/<pieceId>` (I9) —
 *  everything between the instance and the piece segment, so pieces of one part
 *  share it and bloom together. */
function partKey(id: string): string {
  const segs = id.split("/");
  return segs.length >= 3 ? segs.slice(1, -1).join("/") : id;
}

interface PartAccum {
  ids: string[];
  sum: Vec3;
  n: number;
}

/**
 * `Map<pieceId, displacement-at-factor-1>` — each piece's full bloom offset in
 * instance-local space, shared across the part so the part stays rigid. A
 * single-part assembly (or a part on the centroid) gets a zero offset; an empty
 * instance contributes nothing. The offsets sum to zero (a balanced bloom).
 */
export function pieceExplodeOffsets(
  scene: Scene3D,
  spread = DEFAULT_EXPLODE_SPREAD,
): Map<string, Vec3> {
  const out = new Map<string, Vec3>();
  for (const instance of scene.instances) {
    const n = instance.pieces.length;
    if (n === 0) continue;

    // Group pieces by part; accumulate each part's midpoint sum + the assembly's.
    const parts = new Map<string, PartAccum>();
    const all: Vec3 = [0, 0, 0];
    for (const piece of instance.pieces) {
      const m = pieceMid(piece.at, piece.rotationArcMin, piece.lengthMm);
      all[0] += m[0];
      all[1] += m[1];
      all[2] += m[2];
      const key = partKey(piece.id);
      let part = parts.get(key);
      if (part === undefined) {
        part = { ids: [], sum: [0, 0, 0], n: 0 };
        parts.set(key, part);
      }
      part.ids.push(piece.id);
      part.sum[0] += m[0];
      part.sum[1] += m[1];
      part.sum[2] += m[2];
      part.n += 1;
    }
    const centroid: Vec3 = [all[0] / n, all[1] / n, all[2] / n];

    for (const part of parts.values()) {
      const partCentroid: Vec3 = [part.sum[0] / part.n, part.sum[1] / part.n, part.sum[2] / part.n];
      const offset = scaleVec(
        [
          partCentroid[0] - centroid[0],
          partCentroid[1] - centroid[1],
          partCentroid[2] - centroid[2],
        ],
        spread,
      );
      for (const id of part.ids) out.set(id, offset);
    }
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
