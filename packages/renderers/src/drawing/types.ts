/**
 * Drawing-emitter type contract (spike, 2026-07-08 — ADR 0102). The 2D
 * technical drawing is a DERIVED view of the one geometry SoT, a sibling of the
 * BOM / cut-list / Scene3D emitters (CORE_SPEC §5). The pipeline is a chain of
 * pure stages, each behind a small interface:
 *
 *   DerivationResult → [SolidModeler] → PieceSolid[]
 *                    → [Sectioner(plane?)] → { solids, cuts }
 *                    → [ViewProjector(view)] → ViewLinework
 *                    → [Annotator(DrawingSpec)] → AnnotationIntent[]
 *                    → [DimensionSolver] → PlacedAnnotation[]
 *                    → [Orchestrator] → TechnicalDrawing
 *
 * All coordinates integer-ish mm; angles integer arc-minutes (I10). Nothing here
 * does I/O (I1) or recomputes geometry from raw config (I4) — it EXPANDS the
 * engine's already-baked pieces (profile + pose), the same posture the R3F walker
 * occupies.
 */
import type { PieceProfile } from "@repo/engine";

import type { Pt, Vec3 } from "../shared.js";

/** View-independent edge roles, assigned by the SolidModeler from the solid's
 *  own topology (NOT visible/hidden — that is per-view, set by the projector). */
export type EdgeRole =
  | "contour" // outer profile outline swept along the axis (the silhouette candidates)
  | "profile-inner" // hollow-profile inner walls (rect_tube / U / L notch) — needs wall data
  | "mitre" // an end-cut face edge (cutArcMin ≠ 90)
  | "longitudinal"; // an extrusion rib connecting the two ends

export interface Edge3D {
  /** `${pieceId}#${edgeKey}` — I9-stable (edgeKey is a canonical ordinal, never
   *  an array index). */
  id: string;
  role: EdgeRole;
  a: Vec3;
  b: Vec3;
}

/** A profile cross-section in the piece's LOCAL section plane, centred on the
 *  axis: u = local Y (transverse, the `wMm` extent), v = local Z (depth, `dMm`).
 *  `nominalDepth` marks a profile the catalog gives no real depth for — the front
 *  elevation is still exact (depth is out-of-plane), but a section degrades to the
 *  outer outline rather than inventing a wall (I5; decision 3 data-fill). */
export interface Section2D {
  outer: Pt[];
  holes: Pt[][];
  nominalDepth: boolean;
}

/** One physical piece as an idealized solid: role-tagged edges both views project
 *  from. The deep module of the pipeline — delete it and there are no real edges,
 *  only the legacy axis-face-quad hack. */
export interface PieceSolid {
  /** `<instanceId>/<partPath>/<pieceId>` or `<partPath>/<pieceId>` (I9). */
  id: string;
  componentCode: string;
  name: string;
  edges: Edge3D[];
  /** The centre axis (start → end), for centrelines + perpendicular-cut detection. */
  axis: { a: Vec3; b: Vec3 };
  /** The piece's pose rotation (arc-minutes) — orients the local cross-section
   *  into world when a section plane cuts it. */
  rotationArcMin: Vec3;
  profile?: PieceProfile;
  /** The section-plane outline (real-depth only carries a genuine hollow). */
  section: Section2D;
  deviated?: boolean;
}

/** An orthographic view direction (no camera, no perspective, no WebGL). */
export interface ViewSpec {
  id: string;
  /** The look direction (world). Front elevation looks along −Z at the XY plane. */
  direction: Vec3;
  /** Screen up (world). */
  up: Vec3;
}

/** Per-view line semantics assigned by the projector. */
export type LineRole = "visible" | "hidden" | "section" | "center";

export interface DrawnEdge2D {
  id: string;
  /** The source Edge3D id (I9) — dimension/annotation anchors reference it. */
  sourceId: string;
  role: LineRole;
  from: Pt;
  to: Pt;
}

export interface ViewLinework {
  viewId: string;
  edges: DrawnEdge2D[];
  bbox: { min: Pt; max: Pt };
}

/** A section plane, authored as DATA (ViewDef.section) — the ADR-0092-deferred
 *  typed plane-spec. `normal` + a point offset along it. */
export interface PlaneSpec {
  normal: Vec3;
  /** Signed distance of the plane from the origin along `normal`, mm. */
  offsetMm: number;
}
