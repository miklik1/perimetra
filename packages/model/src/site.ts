/**
 * Layer D — the Site (CORE_SPEC §5): a project is a land plot of positioned,
 * connected product instances, not one config per quote (I11 — a single gate
 * is a site with one instance, the degenerate case). The site is INPUT data;
 * everything derived from it (assembly graphs, sharing resolution, aggregate
 * BOM) lives on the engine's result, never hand-stored here.
 *
 * Terrain is v1-stepped (per-segment elevation deltas, not a mesh): a
 * placement names the segment it stands on and the engine writes the
 * segment's elevation into the release's declared elevation parameter —
 * through the ordinary input gate, one write path (I7). `boundary` (cadastre
 * import) and mesh terrain are future features on this same shape.
 */
import type { Mm } from "./schema.js";

/** One stepped-terrain segment ("the left plot is 150 higher"). */
export interface TerrainSegment {
  id: string;
  /** Ground elevation relative to the site datum, integer mm (I10). */
  elevation_mm: Mm;
}

/** Position of an instance on the plot. Consumed by the renderers (step 5);
 *  rotation is integer arc-minutes (I10 — never float degrees). */
export interface Pose {
  origin_mm: { x: Mm; y: Mm };
  rotationArcMin?: number;
}

export interface SitePlacement {
  instanceId: string;
  pose: Pose;
  /** Segment this instance stands on; drives the release's elevation
   *  parameter. Omitted = the parameter's own default applies. */
  terrainSegmentId?: string;
}

export interface ConnectionEnd {
  instanceId: string;
  /** PortDef.id on that instance's release. */
  portId: string;
}

/** An undirected port-to-port connection. Sharing/ownership (I6) is RESOLVED
 *  by the engine from the two ports' declarations — never stored on input. */
export interface SiteConnection {
  a: ConnectionEnd;
  b: ConnectionEnd;
}

export interface Site {
  id: string;
  terrain: TerrainSegment[];
  placements: SitePlacement[];
  connections: SiteConnection[];
}
