/**
 * Shared renderer plumbing — the consumed-element set (I6) and deterministic
 * arc-minute trigonometry. Every renderer consumes the derived site result
 * only (I4): nothing here reads a release, a config, or the catalog.
 *
 * Conventions (assembly space, set by the engine's geometry contract):
 *   - X across, Y up, Z toward the viewer; lengths in mm.
 *   - A piece's origin is the START of its axis; the cross-section is
 *     centered on the axis (a vertical post `at` ground level, rotated 90°
 *     about Z, spans y ∈ [ground, ground + length]).
 *   - Site poses map plan coordinates onto world axes: plan x → X,
 *     plan y → Z; pose rotation turns about the up axis (Y).
 */
import type { SiteResult } from "@repo/engine";

export type Vec3 = [number, number, number];
export type Pt = { x: number; y: number };

/** Site addresses (`<instanceId>/<partPath>`) of elements dropped by sharing
 *  resolution (I6) — the owner's element is the one that renders. */
export function consumedParts(result: SiteResult): Set<string> {
  return new Set(result.sharing.map((s) => `${s.consumerInstanceId}/${s.consumedPartPath}`));
}

/** Every renderer refuses an invalid result the same way: an invalid site has
 *  no geometric truth to render (I5 — no partial outputs, ever). */
export function assertRenderable(result: { isValid: boolean }, what: string): void {
  if (!result.isValid) {
    throw new Error(`Cannot render ${what} from an invalid derivation result (I5)`);
  }
}

const ARCMIN_FULL_TURN = 21600;
const ARCMIN_QUARTER = 5400;

/** Exact at quarter turns so axis-aligned geometry stays integer-exact
 *  (IEEE cos(π/2) ≈ 6e-17 would smear every vertical post's bbox). */
export function cosArcMin(arcMin: number): number {
  const norm = ((arcMin % ARCMIN_FULL_TURN) + ARCMIN_FULL_TURN) % ARCMIN_FULL_TURN;
  if (norm % ARCMIN_QUARTER === 0) return [1, 0, -1, 0][norm / ARCMIN_QUARTER]!;
  return Math.cos((norm / 60) * (Math.PI / 180));
}

export function sinArcMin(arcMin: number): number {
  const norm = ((arcMin % ARCMIN_FULL_TURN) + ARCMIN_FULL_TURN) % ARCMIN_FULL_TURN;
  if (norm % ARCMIN_QUARTER === 0) return [0, 1, 0, -1][norm / ARCMIN_QUARTER]!;
  return Math.sin((norm / 60) * (Math.PI / 180));
}

/** Rotate about X, then Y, then Z (the piece-rotation convention). */
export function rotate(p: Vec3, rotationArcMin: Vec3): Vec3 {
  let [x, y, z] = p;
  const [rx, ry, rz] = rotationArcMin;
  if (rx !== 0) {
    const c = cosArcMin(rx);
    const s = sinArcMin(rx);
    [y, z] = [y * c - z * s, y * s + z * c];
  }
  if (ry !== 0) {
    const c = cosArcMin(ry);
    const s = sinArcMin(ry);
    [x, z] = [x * c + z * s, -x * s + z * c];
  }
  if (rz !== 0) {
    const c = cosArcMin(rz);
    const s = sinArcMin(rz);
    [x, y] = [x * c - y * s, x * s + y * c];
  }
  return [x, y, z];
}

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
