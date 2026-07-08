/**
 * Procedural profile extrusion (ADR 0073, technique 4) — the credibility
 * foundation that replaces the flat `<boxGeometry>`. A `PieceProfile` (the
 * cross-section the engine baked from the catalog section, I4) becomes a real
 * `THREE.Shape`, extruded along the piece length into a beveled solid.
 *
 * Pure CPU geometry (no WebGL) — `THREE.Shape`/`ExtrudeGeometry` build their
 * vertex buffers on the CPU, so this module is unit-testable in jsdom/node, the
 * same discipline as `frame.ts`. The R3F walker (`scene-renderer.tsx`) only
 * attaches what this returns; it never measures.
 *
 * Axis convention (packages/renderers/src/shared.ts): a piece's local frame is
 * X = axis (length), the cross-section centered on the axis in the Y(width)–
 * Z(depth) plane, origin at the START of the axis. We therefore build the
 * cross-section in the shape plane as (X_shape = depth, Y_shape = width),
 * extrude along +Z by the length, then `rotateY(π/2)` so the extrude axis maps
 * to local-X (span x∈[0,length], origin at start) — matching what the box did,
 * with the cross-section now a true profile.
 */
import { ExtrudeGeometry, Path, Shape, type BufferGeometry } from "three";

import type { PieceProfile } from "@repo/engine";
import { profileEnvelope } from "@repo/renderers";

/** Width (Y) and depth (Z) of the cross-section, mm. The REAL catalog envelope is
 *  read through `profileEnvelope` (ProfileLibrary) — the SAME authority the 2D
 *  drawing emitter sections from, so the two can never disagree about how big a
 *  member is (the convergence, ADR 0102). Only the fallback for absent catalog
 *  dims is app-land PRESENTATION: `?? 40`, and a thinner default depth for
 *  flat/pane planks so a plaňka reads as a board, not a square bar — never
 *  invented data written anywhere durable. */
function resolveDims(profile: PieceProfile): { wMm: number; dMm: number } {
  const env = profileEnvelope(profile);
  const wMm = env.halfW > 0 ? env.halfW * 2 : 40;
  const thinDefault = profile.shape === "flat" || profile.shape === "pane" ? 20 : wMm;
  // `nominalDepth` is ProfileLibrary's verdict that the catalog gave no real
  // depth — the one place that decision is made, for 2D and 3D alike.
  return { wMm, dMm: env.nominalDepth ? thinDefault : env.halfD * 2 };
}

/** Leg/wall thickness for the open sections (L/U/T) when the catalog carries no
 *  `wall_mm` — an approximated silhouette so the profile reads as itself. */
function approxWall(profile: PieceProfile, wMm: number, dMm: number): number {
  if (profile.wallMm !== undefined && profile.wallMm > 0) return profile.wallMm;
  return Math.min(Math.max(Math.min(wMm, dMm) * 0.18, 3), 12);
}

/**
 * The 2D cross-section as a `THREE.Shape` in the (X=depth, Y=width) plane,
 * centered on the origin — or `null` for a shape we don't model (`custom`),
 * which the caller renders as the box fallback. Symmetric profiles
 * (rect_tube/flat/pane) are exact; the open sections (L/U/T) are silhouettes.
 */
export function buildProfileShape(profile: PieceProfile): Shape | null {
  const { wMm, dMm } = resolveDims(profile);
  const hx = dMm / 2; // half-depth → shape X
  const hy = wMm / 2; // half-width → shape Y

  switch (profile.shape) {
    case "rect_tube":
    case "flat":
    case "pane": {
      const shape = new Shape();
      shape.moveTo(-hx, -hy);
      shape.lineTo(hx, -hy);
      shape.lineTo(hx, hy);
      shape.lineTo(-hx, hy);
      shape.closePath();
      // A hollow section only when the catalog gives a real wall (never invent
      // one — a jakl with no wall_mm renders solid, honestly).
      const wall = profile.wallMm;
      if (
        profile.shape === "rect_tube" &&
        wall !== undefined &&
        wall > 0 &&
        wall * 2 < dMm &&
        wall * 2 < wMm
      ) {
        const hole = new Path();
        hole.moveTo(-hx + wall, -hy + wall);
        hole.lineTo(hx - wall, -hy + wall);
        hole.lineTo(hx - wall, hy - wall);
        hole.lineTo(-hx + wall, hy - wall);
        hole.closePath();
        shape.holes.push(hole);
      }
      return shape;
    }
    case "L": {
      const t = approxWall(profile, wMm, dMm);
      const shape = new Shape();
      // Bottom leg + left leg (an angle), bounded by the profile's w×d.
      shape.moveTo(-hx, -hy);
      shape.lineTo(hx, -hy);
      shape.lineTo(hx, -hy + t);
      shape.lineTo(-hx + t, -hy + t);
      shape.lineTo(-hx + t, hy);
      shape.lineTo(-hx, hy);
      shape.closePath();
      return shape;
    }
    case "U": {
      const t = approxWall(profile, wMm, dMm);
      const shape = new Shape();
      // Channel opening toward +Y (web on the −X side).
      shape.moveTo(-hx, -hy);
      shape.lineTo(hx, -hy);
      shape.lineTo(hx, hy);
      shape.lineTo(hx - t, hy);
      shape.lineTo(hx - t, -hy + t);
      shape.lineTo(-hx + t, -hy + t);
      shape.lineTo(-hx + t, hy);
      shape.lineTo(-hx, hy);
      shape.closePath();
      return shape;
    }
    case "T": {
      const t = approxWall(profile, wMm, dMm);
      const shape = new Shape();
      // Flange along −X edge (full width) + stem toward +X (centered on Y).
      shape.moveTo(-hx, -hy);
      shape.lineTo(-hx + t, -hy);
      shape.lineTo(-hx + t, -t / 2);
      shape.lineTo(hx, -t / 2);
      shape.lineTo(hx, t / 2);
      shape.lineTo(-hx + t, t / 2);
      shape.lineTo(-hx + t, hy);
      shape.lineTo(-hx, hy);
      shape.closePath();
      return shape;
    }
    default:
      return null;
  }
}

/** Stable cache key — identical (shape, dims, length) share one GPU buffer. */
function geometryKey(profile: PieceProfile, lengthMm: number): string {
  return `${profile.shape}|${profile.wMm ?? ""}|${profile.dMm ?? ""}|${profile.wallMm ?? ""}|${lengthMm}`;
}

/** A small bevel gives the specular edge the studio render implies — kept tiny
 *  and clamped under the wall so a thin section never self-intersects. */
function bevelFor(profile: PieceProfile): number {
  const { wMm, dMm } = resolveDims(profile);
  const limit = Math.min(wMm, dMm, profile.wallMm ?? Infinity) / 4;
  return Math.min(0.6, limit);
}

// Module-level cache (LRU-capped). Geometries are shared across every piece with
// the same (shape, dims, length) — the cache OWNS their lifecycle: it disposes a
// buffer only when evicting it, and the cap (256) is far above any single
// scene's distinct-geometry count, so a geometry attached to a mounted mesh is
// always recently-touched and never evicted out from under it.
const CACHE_CAP = 256;
const cache = new Map<string, ExtrudeGeometry>();

/**
 * The extruded, axis-aligned geometry for a piece — or `null` when the profile
 * isn't modellable (`custom`, or no profile), so the caller draws the box
 * fallback. Cached by value; re-deriving the same scene reuses the buffers.
 */
export function buildPieceGeometry(
  profile: PieceProfile | undefined,
  lengthMm: number,
): BufferGeometry | null {
  if (profile === undefined || lengthMm <= 0) return null;
  const key = geometryKey(profile, lengthMm);
  const hit = cache.get(key);
  if (hit !== undefined) {
    // Touch → most-recently-used (Map preserves insertion order).
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }

  const shape = buildProfileShape(profile);
  if (shape === null) return null;

  const bevel = bevelFor(profile);
  const geometry = new ExtrudeGeometry(shape, {
    depth: lengthMm,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 1,
    steps: 1,
  });
  // Extrude runs along +Z from the shape plane; rotate so depth → local-X
  // (origin at the axis start, span x∈[0, lengthMm]), matching shared.ts.
  geometry.rotateY(Math.PI / 2);
  geometry.computeVertexNormals();

  cache.set(key, geometry);
  if (cache.size > CACHE_CAP) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) {
      cache.get(oldest)?.dispose();
      cache.delete(oldest);
    }
  }
  return geometry;
}

/** Test/diagnostic hooks — never used by the render path. */
export function _geometryCacheSize(): number {
  return cache.size;
}
export function _clearGeometryCache(): void {
  for (const g of cache.values()) g.dispose();
  cache.clear();
}
