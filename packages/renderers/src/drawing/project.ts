/**
 * ViewProjector (⊕ HLR) — projection and hidden-line removal are ONE stage:
 * orthographic projection alone is a trivial rotate-and-drop that fails the
 * deletion test as its own seam. Pure vector DATA out (DrawnEdge2D), never a
 * raster of the WebGL render. Multi-view is the same call with a different
 * ViewSpec ("views for free").
 *
 * HLR — Phase-2 FLOOR = silhouette-outline: project every edge, quantise to
 * integer mm (deterministic, T-junction-free), drop head-on-degenerate edges
 * (a box's depth ribs vanish in a face-on view) and DEDUP coincident segments
 * (a box's front and back face project onto the same rectangle). For a coplanar
 * family (the branka leaf) this yields the exact elevation with no doubled lines.
 * Full analytic occlusion (deeper edge → dashed `hidden`) is the stretch; the
 * interface is identical, so it slots in without touching downstream stages.
 */
import type { Pt, Vec3 } from "../shared.js";
import type { DrawnEdge2D, LineRole, PieceSolid, ViewLinework, ViewSpec } from "./types.js";

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a: Vec3): Vec3 => {
  const m = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / m, a[1] / m, a[2] / m];
};

interface Basis {
  right: Vec3;
  up: Vec3;
  depth: Vec3;
}

/** Screen basis: x = right, y = up, depth toward the viewer (−look). */
function basisOf(view: ViewSpec): Basis {
  const forward = norm(view.direction);
  const up = norm(view.up);
  const right = norm(cross(forward, up));
  return { right, up, depth: [-forward[0], -forward[1], -forward[2]] };
}

/** mm snap — integer coordinates keep the vector golden byte-stable (I1/I3). */
const snap = (n: number): number => Math.round(n);
const key = (p: Pt): string => `${p.x},${p.y}`;
/** Order-independent segment key so front/back coincident faces dedup. */
const segKey = (a: Pt, b: Pt): string =>
  key(a) < key(b) ? `${key(a)}|${key(b)}` : `${key(b)}|${key(a)}`;

export const FRONT_VIEW: ViewSpec = { id: "front", direction: [0, 0, -1], up: [0, 1, 0] };
export const SIDE_VIEW: ViewSpec = { id: "side", direction: [-1, 0, 0], up: [0, 1, 0] };
export const TOP_VIEW: ViewSpec = { id: "top", direction: [0, -1, 0], up: [0, 0, -1] };

export function renderView(solids: readonly PieceSolid[], view: ViewSpec): ViewLinework {
  const b = basisOf(view);
  const project = (p: Vec3): { pt: Pt; depth: number } => ({
    pt: { x: snap(dot(p, b.right)), y: snap(dot(p, b.up)) },
    depth: dot(p, b.depth),
  });

  // Keep the deepest-toward-viewer instance of each coincident segment (the
  // front face wins over the back). Silhouette FLOOR → every surviving line is
  // visible; occlusion (deeper → hidden) is the stretch that slots in here.
  const best = new Map<string, { edge: DrawnEdge2D; depth: number }>();
  let min: Pt | undefined;
  let max: Pt | undefined;
  const grow = (p: Pt): void => {
    min = min === undefined ? { ...p } : { x: Math.min(min.x, p.x), y: Math.min(min.y, p.y) };
    max = max === undefined ? { ...p } : { x: Math.max(max.x, p.x), y: Math.max(max.y, p.y) };
  };

  for (const solid of solids) {
    for (const edge of solid.edges) {
      const pa = project(edge.a);
      const pb = project(edge.b);
      if (pa.pt.x === pb.pt.x && pa.pt.y === pb.pt.y) continue; // head-on degenerate (depth rib)
      const sk = segKey(pa.pt, pb.pt);
      const depth = (pa.depth + pb.depth) / 2;
      const role: LineRole = "visible";
      const existing = best.get(sk);
      if (existing === undefined || depth > existing.depth) {
        best.set(sk, {
          edge: { id: `${edge.id}@${view.id}`, sourceId: edge.id, role, from: pa.pt, to: pb.pt },
          depth,
        });
      }
      grow(pa.pt);
      grow(pb.pt);
    }
  }

  const edges: DrawnEdge2D[] = [...best.values()]
    .sort((a, z) => a.edge.sourceId.localeCompare(z.edge.sourceId)) // I9-stable order
    .map((v) => v.edge);

  return {
    viewId: view.id,
    edges,
    bbox: { min: min ?? { x: 0, y: 0 }, max: max ?? { x: 0, y: 0 } },
  };
}
