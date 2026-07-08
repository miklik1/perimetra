/**
 * ProfileLibrary — the SINGLE authority on what a catalog cross-section looks
 * like (CORE_SPEC §5 geometry). Both the 2D drawing and (after convergence) the
 * R3F 3D walker resolve their cross-section through here, so there is structurally
 * one shape truth and no drift. Exported from `@repo/renderers` from day one for
 * exactly that convergence.
 *
 * Section coordinates are LOCAL to the piece: u = local Y (the `wMm` transverse
 * extent), v = local Z (the `dMm` depth), centred on the axis — matching the
 * sweep convention in `shared.ts` (a piece's cross-section is centred on its axis).
 *
 * HONESTY (I5, catalog "never invent physics"): the OUTER envelope is exact from
 * the catalog's `wMm`/`dMm`. Hollow/leg detail (rect_tube / U / L / T inner walls)
 * needs `wallMm` the catalog does not yet carry for these sections — so this
 * returns the outer outline + `nominalDepth`/no-holes and the section stage draws
 * a solid-hatched envelope, never an invented wall. When FIL wall data lands, the
 * hole loops fill in here and every section upgrades with no interface change.
 */
import type { PieceProfile } from "@repo/engine";

import type { Pt } from "../shared.js";
import type { Section2D } from "./types.js";

export interface ProfileEnvelope {
  /** Half the transverse extent (local Y, from `wMm`). Always real. */
  halfW: number;
  /** Half the depth extent (local Z, from `dMm`). 0 when the catalog gives no
   *  depth — the piece is modelled as a planar front face (front elevation stays
   *  exact; side/section know depth is unknown). */
  halfD: number;
  /** True when `dMm` is absent → depth is not real catalog data. */
  nominalDepth: boolean;
}

/** The transverse/depth half-extents of a profile. `wMm` is required for any
 *  geometry-bearing piece; `dMm` is optional (flats, U-channels carry only wMm). */
export function profileEnvelope(profile: PieceProfile | undefined): ProfileEnvelope {
  const halfW = (profile?.wMm ?? 0) / 2;
  const dMm = profile?.dMm;
  return { halfW, halfD: dMm === undefined ? 0 : dMm / 2, nominalDepth: dMm === undefined };
}

/**
 * The section-plane outline of a profile (a cut perpendicular to the axis). Outer
 * rectangle from the real envelope; holes only when `wallMm` is present (none of
 * the current sliding-gate/branka sections carry it → solid-hatched envelope).
 */
export function sectionOutline(profile: PieceProfile | undefined): Section2D {
  const { halfW, halfD, nominalDepth } = profileEnvelope(profile);
  // Depth-less profiles (flat plank, h-channel with no dMm) get a hairline depth
  // so the outline is a proper (degenerate-thin) rectangle the section can hatch;
  // nominalDepth flags it as scaffolding, not fact.
  const v = halfD === 0 ? 0.5 : halfD;
  const outer: Pt[] = [
    { x: -halfW, y: -v },
    { x: halfW, y: -v },
    { x: halfW, y: v },
    { x: -halfW, y: v },
  ];
  // wallMm → inner hole loop would go here (rect_tube/U/L). Absent today.
  const holes: Pt[][] = [];
  return { outer, holes, nominalDepth };
}
