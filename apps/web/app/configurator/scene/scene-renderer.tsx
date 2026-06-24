"use client";

import { useMemo } from "react";
import { Euler } from "three";

import type { Scene3D, ScenePiece, Vec3 } from "@repo/renderers";

import { buildPieceGeometry } from "./profile-geometry";

/**
 * The R3F walker over the pure Scene3D data (ADR 0050/0051 — the `~/gates`
 * walker pattern, ported onto the rebuild's renderer contract): instances are
 * site-posed groups, every piece a profile-sized box along its local X axis.
 * Geometry truth lives entirely in the data (I4) — this file only maps it
 * onto three.js, it never measures or recomputes.
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

/** Deterministic per-component hue so distinct profiles read apart; a piece
 *  carrying a deviation flag (CORE_SPEC §6) renders in warning orange. */
const PALETTE = ["#7d8a99", "#9aa5b1", "#6f7d8c", "#8c97a3", "#a8b2bc", "#5e6c7b"];

function colorFor(piece: ScenePiece): string {
  if (piece.deviated === true) return "#e07b39";
  let hash = 0;
  for (const ch of piece.componentCode) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return PALETTE[Math.abs(hash) % PALETTE.length]!;
}

function Piece({ piece }: { piece: ScenePiece }) {
  const rotation = useMemo(() => euler(piece.rotationArcMin), [piece.rotationArcMin]);
  // Procedural profile extrusion (ADR 0073): a real cross-section solid, cached
  // by value across identical pieces. `null` (no profile / custom shape) falls
  // back to the flat box, centered and pushed to span [0, length] like before.
  const geometry = useMemo(
    () => buildPieceGeometry(piece.profile, piece.lengthMm),
    [piece.profile, piece.lengthMm],
  );
  const color = colorFor(piece);

  return (
    <group position={piece.at} rotation={rotation}>
      {geometry !== null ? (
        // The extruded geometry already spans x∈[0, length] from its origin;
        // `dispose={null}` — the module cache owns the shared buffer's lifecycle.
        <mesh geometry={geometry} dispose={null}>
          <meshStandardMaterial color={color} metalness={0.35} roughness={0.55} />
        </mesh>
      ) : (
        <mesh position={[piece.lengthMm / 2, 0, 0]}>
          <boxGeometry
            args={[piece.lengthMm, piece.profile?.wMm ?? 40, piece.profile?.dMm ?? 40]}
          />
          <meshStandardMaterial color={color} metalness={0.35} roughness={0.55} />
        </mesh>
      )}
    </group>
  );
}

export function SceneRenderer({ scene }: { scene: Scene3D }) {
  return (
    <>
      {scene.instances.map((instance) => (
        <group
          key={instance.instanceId}
          position={instance.at}
          rotation={euler(instance.rotationArcMin)}
        >
          {instance.pieces.map((piece) => (
            <Piece key={piece.id} piece={piece} />
          ))}
        </group>
      ))}
    </>
  );
}
