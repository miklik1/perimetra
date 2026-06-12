/**
 * 3D scene emission (CORE_SPEC §5/§6, step 5) — the site graph's pieces as a
 * renderable scene description. Pure data out: the R3F (or any) presentation
 * layer walks instance groups and nests their transforms; it never computes
 * geometry (I4) and never sees a config. Angles stay integer arc-minutes
 * (I10) — presentation converts to radians at the last moment.
 *
 * A shared element (the post between two fence fields) appears exactly once:
 * the consumer's pieces are dropped here the same way its BOM line was (I6).
 */
import type { PieceProfile, SiteResult } from "@repo/engine";
import type { Site } from "@repo/model";

import { assertRenderable, consumedParts, type Vec3 } from "./shared";

export interface ScenePiece {
  /** `<instanceId>/<partPath>/<pieceId>` (I9). */
  id: string;
  componentCode: string;
  /** Part display name (the piece's workshop label builds on it). */
  name: string;
  lengthMm: number;
  profile?: PieceProfile;
  /** Instance-local origin, mm. */
  at: Vec3;
  rotationArcMin: Vec3;
  /** The part carries an artifact-override deviation (CORE_SPEC §6) — the
   *  scene surfaces it so no surface can hide a deviated element. */
  deviated?: boolean;
}

export interface SceneInstance {
  instanceId: string;
  releaseId: string;
  /** World transform from the site pose (plan x → X, plan y → Z). */
  at: Vec3;
  /** Pose rotation about the up axis (Y). */
  rotationArcMin: Vec3;
  pieces: ScenePiece[];
  /** Evaluated port anchors, instance-local — canvas snapping/markers. */
  anchors?: Record<string, Vec3>;
}

export interface Scene3D {
  units: "mm";
  /** X across, Y up, Z toward the viewer; (0,0,0) is the site datum. */
  instances: SceneInstance[];
}

export function buildScene(site: Site, result: SiteResult): Scene3D {
  assertRenderable(result, "a 3D scene");
  const consumed = consumedParts(result);

  const instances = site.placements.map((placement): SceneInstance => {
    const instance = result.instances[placement.instanceId];
    if (instance === undefined) {
      // A valid SiteResult carries every placed instance — this is a caller
      // wiring bug (site/result mismatch), not user input.
      throw new Error(`No derivation result for placed instance "${placement.instanceId}"`);
    }

    const pieces: ScenePiece[] = [];
    for (const part of instance.parts) {
      if (part.geometry === undefined) continue;
      if (consumed.has(`${placement.instanceId}/${part.path}`)) continue;
      const deviated = part.deviations !== undefined && part.deviations.length > 0;
      for (const piece of part.geometry.pieces) {
        pieces.push({
          id: `${placement.instanceId}/${part.path}/${piece.id}`,
          componentCode: part.componentCode,
          name: part.name,
          lengthMm: piece.lengthMm,
          ...(part.geometry.profile !== undefined && { profile: part.geometry.profile }),
          at: piece.at,
          rotationArcMin: piece.rotationArcMin,
          ...(deviated && { deviated: true }),
        });
      }
    }

    return {
      instanceId: placement.instanceId,
      releaseId: result.stamps.releaseIds[placement.instanceId]!,
      at: [placement.pose.origin_mm.x, 0, placement.pose.origin_mm.y],
      rotationArcMin: [0, placement.pose.rotationArcMin ?? 0, 0],
      pieces,
      ...(instance.anchors !== undefined && { anchors: instance.anchors }),
    };
  });

  return { units: "mm", instances };
}
