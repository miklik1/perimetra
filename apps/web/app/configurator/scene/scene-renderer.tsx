"use client";

import { useMemo } from "react";
import { Euler, type Texture } from "three";

import type { Scene3D, ScenePiece, Vec3 } from "@repo/renderers";

import { finishById, useFinish, woodTexture, type FinishMaterial } from "./finish";
import { buildPieceGeometry } from "./profile-geometry";

/**
 * The R3F walker over the pure Scene3D data (ADR 0050/0051 — the `~/gates`
 * walker pattern, ported onto the rebuild's renderer contract): instances are
 * site-posed groups, every piece a profile extrusion along its local X axis.
 * Geometry truth lives entirely in the data (I4) — this file only maps it
 * onto three.js, it never measures or recomputes.
 *
 * Material is PRESENTATION (ADR 0075): the chosen finish (`finish.ts`, a zustand
 * slice) recolours every piece with a synchronous prop update — no raster swap.
 * The §6 deviation amber is layered ABOVE the finish: a deviated piece renders
 * amber at ANY finish, so no colour choice can hide it (CORE_SPEC §6).
 *
 * Conventions (packages/renderers/src/shared.ts): piece origin is the START
 * of its axis, cross-section centered on the axis, rotation applied X→Y→Z
 * about fixed axes — which is three.js Euler order "ZYX".
 */
const ARC_MIN_TO_RAD = Math.PI / (180 * 60);

function euler(rotationArcMin: Vec3): Euler {
  return new Euler(
    rotationArcMin[0] * ARC_MIN_TO_RAD,
    rotationArcMin[1] * ARC_MIN_TO_RAD,
    rotationArcMin[2] * ARC_MIN_TO_RAD,
    "ZYX",
  );
}

/** The §6 deviation colour — kept ABOVE the chosen finish (a deviated piece is
 *  amber at any finish, so no surface can hide it). */
const DEVIATION_COLOR = "#e07b39";

function Piece({
  piece,
  material,
  woodMap,
}: {
  piece: ScenePiece;
  material: FinishMaterial;
  woodMap: Texture | null;
}) {
  const rotation = useMemo(() => euler(piece.rotationArcMin), [piece.rotationArcMin]);
  // Procedural profile extrusion (ADR 0073): a real cross-section solid, cached
  // by value across identical pieces. `null` (no profile / custom shape) falls
  // back to the flat box, centered and pushed to span [0, length] like before.
  const geometry = useMemo(
    () => buildPieceGeometry(piece.profile, piece.lengthMm),
    [piece.profile, piece.lengthMm],
  );

  // §6 amber wins over the finish; the wood map only ever decorates a non-deviated
  // piece. The material `key` flips with map-presence so the wood→powder boundary
  // rebuilds the shader (a three.js needsUpdate edge), while a colour-only swap
  // within powder updates live without a remount.
  const deviated = piece.deviated === true;
  const hasMap = !deviated && material.wood === true && woodMap !== null;
  const color = deviated ? DEVIATION_COLOR : material.colorHex;
  const metalness = deviated ? 0.3 : material.metalness;
  const roughness = deviated ? 0.5 : material.roughness;
  const mat = (
    <meshStandardMaterial
      key={hasMap ? "mapped" : "flat"}
      color={color}
      map={hasMap ? woodMap : undefined}
      metalness={metalness}
      roughness={roughness}
    />
  );

  return (
    <group position={piece.at} rotation={rotation}>
      {geometry !== null ? (
        // The extruded geometry already spans x∈[0, length] from its origin;
        // `dispose={null}` — the module cache owns the shared buffer's lifecycle.
        <mesh geometry={geometry} dispose={null}>
          {mat}
        </mesh>
      ) : (
        <mesh position={[piece.lengthMm / 2, 0, 0]}>
          <boxGeometry
            args={[piece.lengthMm, piece.profile?.wMm ?? 40, piece.profile?.dMm ?? 40]}
          />
          {mat}
        </mesh>
      )}
    </group>
  );
}

export function SceneRenderer({ scene }: { scene: Scene3D }) {
  // One subscription: the resolved finish material is a stable reference until
  // the chosen finish changes (the renderer never recomputes it per piece).
  const material = useFinish((s) => finishById(s.finishId).material);
  const woodMap = useMemo(() => woodTexture(), []);

  return (
    <>
      {scene.instances.map((instance) => (
        <group
          key={instance.instanceId}
          position={instance.at}
          rotation={euler(instance.rotationArcMin)}
        >
          {instance.pieces.map((piece) => (
            <Piece key={piece.id} piece={piece} material={material} woodMap={woodMap} />
          ))}
        </group>
      ))}
    </>
  );
}
