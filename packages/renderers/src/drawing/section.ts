/**
 * Sectioner (CORE_SPEC §5, spike — ADR 0102). Cuts the idealized solids with
 * an axis-aligned plane and emits the outer outline of every piece the plane
 * crosses TRANSVERSELY (its axis pierces the plane), hatched — the "how the
 * profiles sit" companion to the elevation. A sibling stage of the ViewProjector:
 * both consume the same PieceSolid[] (the one geometry SoT), so a section can
 * never disagree with the elevation about what a member is.
 *
 * HONESTY (I5, "never invent catalog physics", decision 3): the outline is the
 * profile's OUTER envelope from `sectionOutline` (ProfileLibrary) — no hole is
 * drawn without a real `wallMm`, and a depth-less profile (flat plank, h-channel)
 * sections to a degraded hairline-thin outline flagged `nominalDepth`. The cut is
 * still positioned exactly; only the transverse depth is honestly unknown. When
 * FIL wall/depth data lands, the outline upgrades with no interface change.
 *
 * A member whose axis is PARALLEL to the plane is not "cut through" (it is either
 * clear of the plane or lies within it — an elevation face, not a section), so it
 * is skipped: a section shows cross-sections, never long faces.
 *
 * EXACTNESS (spike scope): the emitted cut is the member's own perpendicular
 * cross-section placed at the pierce point. That is EXACT when the member axis is
 * parallel to the plane normal (the cross-section already lies in the cut plane) —
 * every gate/branka member (axis-aligned, 0°/90° poses) satisfies this. For a
 * member OBLIQUE to the plane (a diagonal brace at, say, 45°) the true cut face is
 * elongated by 1/cos θ, which this does not model — the honest outline is
 * approximate there. No family in the corpus authors an oblique-to-section member;
 * true oblique-cut geometry is a deferred follow-on (ADR 0102).
 */
import type { SectionAxis, SectionDef } from "@repo/model";

import { add, rotate, type Pt, type Vec3 } from "../shared.js";
import type { PieceSolid } from "./types.js";

export interface SectionCut {
  /** The source PieceSolid id (I9). */
  sourceId: string;
  componentCode: string;
  /** Hatched outer outline in the cut-plane 2D frame (mm). */
  outline: Pt[];
  /** The catalog gave this profile no real depth → the outline is a degraded
   *  scaffold, not fact. The consumer flags it (data-fill needed), never silently
   *  presents it as a measured section. */
  nominalDepth: boolean;
}

export interface SectionView {
  sectionId: string;
  axis: SectionAxis;
  offsetMm: number;
  cuts: SectionCut[];
  bbox: { min: Pt; max: Pt };
  /** True when ANY cut is a nominal-depth degrade — the section is honest but
   *  incomplete until the catalog carries the missing depth/wall. */
  dataFillNeeded: boolean;
}

/** Normal index + the in-plane screen basis (e1 → screen-x, e2 → screen-y) for
 *  each axis-aligned cut. `x` = a cross-slice (depth across, height up), `y` = a
 *  plan cut (across × depth), `z` = a front-parallel slice (like the elevation). */
const FRAME: Record<SectionAxis, { n: 0 | 1 | 2; e1: Vec3; e2: Vec3 }> = {
  x: { n: 0, e1: [0, 0, 1], e2: [0, 1, 0] },
  y: { n: 1, e1: [1, 0, 0], e2: [0, 0, 1] },
  z: { n: 2, e1: [1, 0, 0], e2: [0, 1, 0] },
};

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export function buildSection(solids: readonly PieceSolid[], def: SectionDef): SectionView {
  const { n, e1, e2 } = FRAME[def.axis];
  const cuts: SectionCut[] = [];
  let min: Pt | undefined;
  let max: Pt | undefined;
  const grow = (p: Pt): void => {
    min = min === undefined ? { ...p } : { x: Math.min(min.x, p.x), y: Math.min(min.y, p.y) };
    max = max === undefined ? { ...p } : { x: Math.max(max.x, p.x), y: Math.max(max.y, p.y) };
  };

  for (const solid of solids) {
    const va = solid.axis.a[n];
    const vb = solid.axis.b[n];
    if (va === vb) continue; // axis parallel to the plane — no transverse cut
    const t = (def.offsetMm - va) / (vb - va);
    if (t < 0 || t > 1) continue; // the plane misses this member's run
    // A geometry-bearing piece whose profile carries no real width has no
    // cross-section to draw — omit it rather than emit a degenerate zero-width
    // sliver (honest omission; requiring wMm at publish is the upstream fix).
    const us = solid.section.outer.map((s) => s.x);
    if (Math.max(...us) === Math.min(...us)) continue;
    // The point where the axis pierces the plane — the cross-section's centre.
    const p: Vec3 = [
      solid.axis.a[0] + t * (solid.axis.b[0] - solid.axis.a[0]),
      solid.axis.a[1] + t * (solid.axis.b[1] - solid.axis.a[1]),
      solid.axis.a[2] + t * (solid.axis.b[2] - solid.axis.a[2]),
    ];
    // The profile's LOCAL outline (u = local Y, v = local Z) lifted into world at
    // the cut, then dropped onto the plane's 2D screen basis.
    const outline: Pt[] = solid.section.outer.map((s) => {
      const world = add(p, rotate([0, s.x, s.y], solid.rotationArcMin));
      const pt = { x: dot(world, e1), y: dot(world, e2) };
      grow(pt);
      return pt;
    });
    cuts.push({
      sourceId: solid.id,
      componentCode: solid.componentCode,
      outline,
      nominalDepth: solid.section.nominalDepth,
    });
  }

  cuts.sort((a, z) => a.sourceId.localeCompare(z.sourceId)); // I9-stable order
  return {
    sectionId: def.id,
    axis: def.axis,
    offsetMm: def.offsetMm,
    cuts,
    bbox: { min: min ?? { x: 0, y: 0 }, max: max ?? { x: 0, y: 0 } },
    dataFillNeeded: cuts.some((c) => c.nominalDepth),
  };
}
