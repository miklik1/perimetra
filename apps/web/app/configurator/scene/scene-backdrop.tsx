"use client";

import type { SceneFrame } from "./frame";
import { sceneById } from "./scenes";

/**
 * The in-context backdrop (ADR 0093) — a ground plane plus light context geometry
 * placed off the framed gate, so the configured product reads as installed. All
 * procedural boxes/planes (no HDRI, no binary asset — CSP-clean, the Lightformer
 * precedent); the studio IBL + `<ContactShadows>` stay, so the gate keeps its
 * grounding shadow over the visible floor.
 *
 * Everything seats on the gate's true SOLID bottom (`frame.min[1]` — the AABB
 * grown by the profile half-extent, ADR 0092), NOT the axis-centreline `groundY`:
 * an opaque floor at the centreline would slice through the lowest rail. The
 * ground sits 2mm under that, the context rests on it, and `scene-canvas` drops
 * the `<ContactShadows>` to the same level so the shadow reads on the floor.
 *
 * Sized off the `frame`, so a backdrop fits any product. `studio` renders nothing
 * (the v1 neutral field). Dimensions are render-taste — calibrated against
 * Martin's eye, structure here.
 */
export function SceneBackdrop({ sceneId, frame }: { sceneId: string; frame: SceneFrame }) {
  const scene = sceneById(sceneId);
  if (scene.ground === null) return null; // studio — the invisible field

  const { center, radius, min, max } = frame;
  const widthMm = max[0] - min[0];
  const heightMm = max[1] - min[1];
  const depthMm = max[2] - min[2];
  // The gate's lowest solid point is the contact level; the opaque ground sits a
  // hair below it (no clip, no z-fight with the soft shadow at the same level).
  const baseY = min[1];
  const floorY = baseY - 2;

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[center[0], floorY, center[2]]}>
        <planeGeometry args={[radius * 8, radius * 8]} />
        <meshStandardMaterial color={scene.ground.colorHex} roughness={scene.ground.roughness} />
      </mesh>

      {scene.context === "pillars" && (
        <Pillars
          center={center}
          min={min}
          max={max}
          baseY={baseY}
          widthMm={widthMm}
          heightMm={heightMm}
        />
      )}
      {scene.context === "fence" && (
        <Fence
          center={center}
          min={min}
          max={max}
          baseY={baseY}
          widthMm={widthMm}
          heightMm={heightMm}
        />
      )}
      {scene.context === "hedge" && (
        <Hedge
          center={center}
          baseY={baseY}
          widthMm={widthMm}
          heightMm={heightMm}
          depthMm={depthMm}
        />
      )}
    </group>
  );
}

type Span = {
  center: [number, number, number];
  min?: [number, number, number];
  max?: [number, number, number];
  /** Seat level — the gate's solid bottom, so context grounds with the gate. */
  baseY: number;
  widthMm: number;
  heightMm: number;
  depthMm?: number;
};

/** Two masonry pillars flanking the gate — the driveway entrance. */
function Pillars({ min, max, center, baseY, widthMm, heightMm }: Required<Omit<Span, "depthMm">>) {
  const w = Math.max(widthMm * 0.06, 140);
  const h = heightMm * 1.15;
  const y = baseY + h / 2;
  return (
    <>
      {[min[0] - w * 0.7, max[0] + w * 0.7].map((x, i) => (
        <mesh key={i} position={[x, y, center[2]]}>
          <boxGeometry args={[w, h, w]} />
          <meshStandardMaterial color="#9a9488" roughness={0.85} />
        </mesh>
      ))}
    </>
  );
}

/** A run of posts receding left and right — the fence the gate sits in. */
function Fence({ min, max, center, baseY, widthMm, heightMm }: Required<Omit<Span, "depthMm">>) {
  const postW = Math.max(widthMm * 0.03, 70);
  const h = heightMm * 0.85;
  const y = baseY + h / 2;
  const spacing = Math.max(widthMm * 0.4, 900);
  const xs: number[] = [];
  for (let k = 1; k <= 3; k += 1) xs.push(min[0] - spacing * k, max[0] + spacing * k);
  return (
    <>
      {xs.map((x, i) => (
        <mesh key={i} position={[x, y, center[2]]}>
          <boxGeometry args={[postW, h, postW]} />
          <meshStandardMaterial color="#5a5550" roughness={0.8} />
        </mesh>
      ))}
    </>
  );
}

/** A low hedge set back behind the gate — the garden. */
function Hedge({ center, baseY, widthMm, heightMm, depthMm }: Required<Omit<Span, "min" | "max">>) {
  const len = widthMm * 2.4;
  const h = heightMm * 0.55;
  const d = 320;
  const z = center[2] - depthMm / 2 - d * 1.5;
  return (
    <mesh position={[center[0], baseY + h / 2, z]}>
      <boxGeometry args={[len, h, d]} />
      <meshStandardMaterial color="#3c5230" roughness={1} />
    </mesh>
  );
}
