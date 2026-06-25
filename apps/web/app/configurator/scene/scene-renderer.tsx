"use client";

import { useMemo } from "react";
import { Euler, type Texture } from "three";

import type { Scene3D, ScenePiece, Vec3 } from "@repo/renderers";

import { useDeviation } from "./deviation";
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

/** The §6 deviation amber — the brand `--color-deviation` token (ADR 0072),
 *  kept ABOVE the chosen finish (a deviated piece is amber at any finish, so no
 *  surface can hide it) and on its OWN plane from the copper UI accent. */
const DEVIATION_COLOR = "#f59e0b";
/** When the highlight toggle is on (ADR 0076), the non-deviated rest desaturates
 *  to a muted grey so the amber pieces pop out of a busy gate. */
const DESATURATED_COLOR = "#9a9a9a";

function Piece({
  piece,
  material,
  woodMap,
  highlight,
}: {
  piece: ScenePiece;
  material: FinishMaterial;
  woodMap: Texture | null;
  highlight: boolean;
}) {
  const rotation = useMemo(() => euler(piece.rotationArcMin), [piece.rotationArcMin]);
  // Procedural profile extrusion (ADR 0073): a real cross-section solid, cached
  // by value across identical pieces. `null` (no profile / custom shape) falls
  // back to the flat box, centered and pushed to span [0, length] like before.
  const geometry = useMemo(
    () => buildPieceGeometry(piece.profile, piece.lengthMm),
    [piece.profile, piece.lengthMm],
  );

  // §6 amber wins over the finish; the wood map only ever decorates a finished,
  // non-deviated, non-highlight piece. The material `key` flips with map-presence
  // so the wood↔flat boundary rebuilds the shader (a three.js needsUpdate edge),
  // while colour/emissive/metalness swaps update live without a remount.
  const deviated = piece.deviated === true;
  const hasMap = !deviated && !highlight && material.wood === true && woodMap !== null;

  let color: string;
  let metalness: number;
  let roughness: number;
  let emissive = "#000000";
  let emissiveIntensity = 0;
  if (deviated) {
    // Amber at any finish; emissive glow in highlight mode (still amber when off).
    color = DEVIATION_COLOR;
    metalness = 0.2;
    roughness = 0.5;
    if (highlight) {
      emissive = DEVIATION_COLOR;
      emissiveIntensity = 0.55;
    }
  } else if (highlight) {
    // Desaturate the rest so the deviated amber reads against a busy gate.
    color = DESATURATED_COLOR;
    metalness = 0.05;
    roughness = 0.8;
  } else {
    color = material.colorHex;
    metalness = material.metalness;
    roughness = material.roughness;
  }

  const mat = (
    <meshStandardMaterial
      key={hasMap ? "mapped" : "flat"}
      color={color}
      map={hasMap ? woodMap : undefined}
      emissive={emissive}
      emissiveIntensity={emissiveIntensity}
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
  // One subscription each: the resolved finish material is a stable reference
  // until the chosen finish changes; `highlight` is the §6 emphasis toggle.
  const material = useFinish((s) => finishById(s.finishId).material);
  const highlight = useDeviation((s) => s.highlight);
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
            <Piece
              key={piece.id}
              piece={piece}
              material={material}
              woodMap={woodMap}
              highlight={highlight}
            />
          ))}
        </group>
      ))}
    </>
  );
}
