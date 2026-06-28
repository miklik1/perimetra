/**
 * Section / cutaway cut plane — the PURE half (ADR 0092). A section view is pure
 * PRESENTATION: a three.js clipping plane discards fragments on one side, so the
 * extruded profiles reveal their hollow cross-sections. It re-derives nothing
 * (I4) — it is a deterministic function of the already-framed scene AABB. No
 * three.js here (the R3F side builds the `Plane` from this data), so the geometry
 * is unit-testable in plain node.
 *
 * Convention: the plane KEEPS the lower-coordinate half on the chosen axis and
 * clips the rest; `position` (0..1) slides the cut from the AABB minimum to its
 * maximum. three.js keeps a fragment where `normal · point + constant >= 0`, so
 * the inward normal points to the negative axis direction and `constant` is the
 * world cut coordinate.
 */
import type { Vec3 } from "@repo/renderers";

import type { SceneFrame } from "./frame";

export type SectionAxis = "x" | "y" | "z";

const AXIS_INDEX: Record<SectionAxis, 0 | 1 | 2> = { x: 0, y: 1, z: 2 };

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

export interface SectionPlaneData {
  /** Inward normal (unit, negative axis direction). */
  normal: Vec3;
  /** World cut coordinate on the axis (the three.js plane `constant`). */
  constant: number;
}

/** The cut plane for `axis` at `position` (0 = AABB min, 1 = AABB max). */
export function sectionPlane(
  frame: SceneFrame,
  axis: SectionAxis,
  position: number,
): SectionPlaneData {
  const i = AXIS_INDEX[axis];
  const lo = frame.min[i];
  const hi = frame.max[i];
  const cut = lo + (hi - lo) * clamp01(position);
  const normal: Vec3 = [0, 0, 0];
  normal[i] = -1;
  return { normal, constant: cut };
}

/** The next axis in the X→Y→Z→X cycle (the viewport axis toggle). */
export function nextAxis(axis: SectionAxis): SectionAxis {
  return axis === "x" ? "y" : axis === "y" ? "z" : "x";
}
