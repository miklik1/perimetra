/**
 * 2D drawing emission (CORE_SPEC §5/§6, step 5) — two products off the one
 * site graph (I4): the per-instance WORKSHOP VIEW (front elevation, XY) and
 * the SITE PLAN (top view, world XZ). Pure data out — primitives in mm; the
 * presentation layer (SVG/canvas/PDF) only draws, never measures.
 *
 * The workshop view renders every artifact-override deviation as a mandatory
 * flag (CORE_SPEC §6): the salesperson is never blocked, the workshop always
 * sees what deviated.
 */
import type { DerivationResult, SiteResult } from "@repo/engine";
import type { Site } from "@repo/model";

import { add, assertRenderable, consumedParts, rotate, type Pt, type Vec3 } from "./shared";

/** A piece's axis face (length × profile width) projected to the view plane.
 *  Quads, not bboxes — a 35° diagonal stays a slanted bar on the drawing. */
export interface DrawingQuad {
  /** Piece address (I9): `<partPath>/<pieceId>` (workshop view, one instance)
   *  or `<instanceId>/<partPath>/<pieceId>` (site plan). */
  id: string;
  componentCode: string;
  points: [Pt, Pt, Pt, Pt];
  deviated?: boolean;
}

export interface DrawingDim {
  id: string;
  from: Pt;
  to: Pt;
  valueMm: number;
}

/** The mandatory deviation flag (CORE_SPEC §6), rendered on the drawing. */
export interface DrawingFlag {
  partPath: string;
  field: string;
  original?: number;
  value: number;
  overrideId: string;
  reason?: string;
}

export interface WorkshopDrawing {
  quads: DrawingQuad[];
  /** Overall width (below) and height (right of) the view. */
  dims: DrawingDim[];
  flags: DrawingFlag[];
  bbox: { min: Pt; max: Pt };
}

/** Front elevation of ONE instance in assembly space — what the workshop
 *  builds from. Takes the instance's own result: sharing is a SITE concern;
 *  the standalone drawing of a fence run correctly shows both end posts. */
export function buildWorkshopDrawing(result: DerivationResult): WorkshopDrawing {
  assertRenderable(result, "a workshop drawing");

  const quads: DrawingQuad[] = [];
  const flags: DrawingFlag[] = [];
  let min: Pt | undefined;
  let max: Pt | undefined;

  for (const part of result.parts) {
    for (const deviation of part.deviations ?? []) {
      flags.push({
        partPath: part.path,
        field: deviation.field,
        ...(deviation.original !== undefined && { original: deviation.original }),
        value: deviation.value,
        overrideId: deviation.overrideId,
        ...(deviation.reason !== undefined && { reason: deviation.reason }),
      });
    }
    if (part.geometry === undefined) continue;
    const deviated = part.deviations !== undefined && part.deviations.length > 0;
    const halfW = (part.geometry.profile?.wMm ?? 0) / 2;

    for (const piece of part.geometry.pieces) {
      // Corners of the axis face (z = 0 plane locally), rotated, projected XY.
      const corners: Vec3[] = [
        [0, -halfW, 0],
        [piece.lengthMm, -halfW, 0],
        [piece.lengthMm, halfW, 0],
        [0, halfW, 0],
      ];
      const points = corners.map((corner) => {
        const [x, y] = add(rotate(corner, piece.rotationArcMin), piece.at);
        const pt: Pt = { x, y };
        min = min === undefined ? { ...pt } : { x: Math.min(min.x, x), y: Math.min(min.y, y) };
        max = max === undefined ? { ...pt } : { x: Math.max(max.x, x), y: Math.max(max.y, y) };
        return pt;
      }) as [Pt, Pt, Pt, Pt];
      quads.push({
        id: `${part.path}/${piece.id}`,
        componentCode: part.componentCode,
        points,
        ...(deviated && { deviated: true }),
      });
    }
  }

  const bbox = { min: min ?? { x: 0, y: 0 }, max: max ?? { x: 0, y: 0 } };
  const dims: DrawingDim[] =
    quads.length === 0
      ? []
      : [
          {
            id: "overall.width",
            from: { x: bbox.min.x, y: bbox.min.y },
            to: { x: bbox.max.x, y: bbox.min.y },
            valueMm: bbox.max.x - bbox.min.x,
          },
          {
            id: "overall.height",
            from: { x: bbox.max.x, y: bbox.min.y },
            to: { x: bbox.max.x, y: bbox.max.y },
            valueMm: bbox.max.y - bbox.min.y,
          },
        ];

  return { quads, dims, flags, bbox };
}

export interface SitePlanInstance {
  instanceId: string;
  /** Top-view outline (plan coordinates): the instance's piece bbox as a
   *  quad, so pose rotation stays visible. */
  outline: [Pt, Pt, Pt, Pt];
  /** Outline centroid — where the label goes. */
  labelAt: Pt;
}

export interface SitePlanConnection {
  /** Index into site.connections (the stable input position). */
  connection: number;
  from: Pt;
  to: Pt;
  /** Present when this connection shares an element (I6) — the plan marks
   *  the one owned post. */
  shared?: { ownerInstanceId: string; partPath: string };
}

export interface SitePlan {
  instances: SitePlanInstance[];
  connections: SitePlanConnection[];
  terrain: { id: string; elevationMm: number; instanceIds: string[] }[];
}

/** World-plan point of an instance-local position under a site pose (plan x =
 *  world X, plan y = world Z). The single plan-coordinate transform (I4) — the
 *  site canvas reuses it for connection handles off derived port anchors. */
export function toPlan(local: Vec3, pose: { origin: Pt; rotationArcMin: number }): Pt {
  const [x, , z] = rotate(local, [0, pose.rotationArcMin, 0]);
  return { x: pose.origin.x + x, y: pose.origin.y + z };
}

export function buildSitePlan(site: Site, result: SiteResult): SitePlan {
  assertRenderable(result, "a site plan");
  const consumed = consumedParts(result);

  const poses = new Map(
    site.placements.map((placement) => [
      placement.instanceId,
      {
        origin: { x: placement.pose.origin_mm.x, y: placement.pose.origin_mm.y },
        rotationArcMin: placement.pose.rotationArcMin ?? 0,
      },
    ]),
  );

  const instances = site.placements.map((placement): SitePlanInstance => {
    const instance = result.instances[placement.instanceId]!;
    const pose = poses.get(placement.instanceId)!;

    // Instance-space XZ bbox over all surviving piece corners.
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const part of instance.parts) {
      if (part.geometry === undefined) continue;
      if (consumed.has(`${placement.instanceId}/${part.path}`)) continue;
      const halfW = (part.geometry.profile?.wMm ?? 0) / 2;
      const halfD = (part.geometry.profile?.dMm ?? part.geometry.profile?.wMm ?? 0) / 2;
      for (const piece of part.geometry.pieces) {
        for (const corner of [
          [0, -halfW, -halfD],
          [piece.lengthMm, -halfW, -halfD],
          [piece.lengthMm, halfW, halfD],
          [0, halfW, halfD],
        ] as Vec3[]) {
          const [x, , z] = add(rotate(corner, piece.rotationArcMin), piece.at);
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minZ = Math.min(minZ, z);
          maxZ = Math.max(maxZ, z);
        }
      }
    }
    if (minX === Infinity) {
      // No geometry at all — a point footprint at the pose origin.
      minX = maxX = minZ = maxZ = 0;
    }

    const outline = (
      [
        [minX, 0, minZ],
        [maxX, 0, minZ],
        [maxX, 0, maxZ],
        [minX, 0, maxZ],
      ] as Vec3[]
    ).map((corner) => toPlan(corner, pose)) as [Pt, Pt, Pt, Pt];
    const labelAt: Pt = {
      x: (outline[0].x + outline[2].x) / 2,
      y: (outline[0].y + outline[2].y) / 2,
    };
    return { instanceId: placement.instanceId, outline, labelAt };
  });

  const centers = new Map(instances.map((i) => [i.instanceId, i.labelAt]));
  const connections = site.connections.map((connection, index): SitePlanConnection => {
    const endPoint = (end: { instanceId: string; portId: string }): Pt => {
      const anchor = result.instances[end.instanceId]?.anchors?.[end.portId];
      const pose = poses.get(end.instanceId);
      if (anchor !== undefined && pose !== undefined) return toPlan(anchor, pose);
      return centers.get(end.instanceId) ?? { x: 0, y: 0 };
    };
    const shared = result.sharing.find((s) => s.connection === index);
    return {
      connection: index,
      from: endPoint(connection.a),
      to: endPoint(connection.b),
      ...(shared !== undefined && {
        shared: { ownerInstanceId: shared.ownerInstanceId, partPath: shared.ownerPartPath },
      }),
    };
  });

  const terrain = site.terrain.map((segment) => ({
    id: segment.id,
    elevationMm: segment.elevation_mm,
    instanceIds: site.placements
      .filter((p) => p.terrainSegmentId === segment.id)
      .map((p) => p.instanceId),
  }));

  return { instances, connections, terrain };
}
