"use client";

import { ContactShadows, Environment, Lightformer, OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { useMemo } from "react";
import { ACESFilmicToneMapping, SRGBColorSpace, type Vector3Tuple } from "three";

import type { Scene3D } from "@repo/renderers";

import { frameScene } from "./frame";
import { SceneRenderer } from "./scene-renderer";

/**
 * The configurator's studio canvas (ADR 0073/0074). World units are mm (hence
 * the far plane); the parent remounts this per release (`key=`), so the initial
 * camera pose just fits the first derivation and OrbitControls owns it after.
 *
 * Studio lighting (ADR 0074, technique 2 — the #1 premium carrier): a procedural
 * drei `<Environment>` built from `<Lightformer>`s gives image-based PBR fill
 * with NO external HDR — the strict CSP blocks drei's preset-HDR CDN, and a
 * lightformer rig renders to an offscreen cube (CSP-clean) AND stays invisible
 * (`background={false}`), so the warm-grey field reads behind the gate. A single
 * key `directionalLight` adds crisp directional modelling on top; `<ContactShadows>`
 * grounds the gate on the scene floor (`frame.groundY`) — replacing the CAD grid
 * with the editorial soft-shadow look.
 */
export default function SceneCanvas({ scene }: { scene: Scene3D }) {
  const frame = useMemo(() => frameScene(scene), [scene]);
  const keyLight: Vector3Tuple = [
    frame.center[0] + frame.radius,
    frame.center[1] + frame.radius * 1.6,
    frame.center[2] + frame.radius,
  ];

  return (
    <Canvas
      gl={{
        antialias: true,
        toneMapping: ACESFilmicToneMapping,
        toneMappingExposure: 1.0,
        outputColorSpace: SRGBColorSpace,
      }}
      camera={{ fov: 45, near: 10, far: 120000, position: frame.cameraPosition }}
      dpr={[1, 2]}
    >
      {/* The Bombardier warm-grey field (brand `--color-field`); IBL stays invisible above it. */}
      <color attach="background" args={["#ededed"]} />

      {/* Soft floor so shadowed faces never crush to black — the IBL carries the fill. */}
      <ambientLight intensity={0.3} />
      {/* One warm key for directional modelling + specular pop on the profile edges. */}
      <directionalLight position={keyLight} intensity={1.6} color="#fff6ec" />

      <SceneRenderer scene={scene} />

      {/* Soft contact shadow grounds the gate on the scene floor (hero mode, no grid). */}
      <ContactShadows
        position={[frame.center[0], frame.groundY, frame.center[2]]}
        scale={frame.radius * 2.6}
        resolution={1024}
        blur={2.6}
        opacity={0.5}
        far={frame.radius * 2.2}
        color="#0a0a0a"
      />

      {/* Procedural studio IBL — invisible (no background), no external HDR (CSP-clean). */}
      <Environment resolution={256} frames={1} background={false}>
        {/* Big soft key from above-front. */}
        <Lightformer
          form="rect"
          intensity={3.2}
          color="#fff6ec"
          position={[2, 5, 6]}
          scale={[10, 10, 1]}
        />
        {/* Cool side fills model the form. */}
        <Lightformer
          form="rect"
          intensity={1.1}
          color="#eef2f6"
          position={[-7, 2, 2]}
          scale={[6, 6, 1]}
        />
        <Lightformer
          form="rect"
          intensity={1.1}
          color="#eef2f6"
          position={[7, 1, -2]}
          scale={[6, 6, 1]}
        />
        {/* Back rim picks out the profiled edges (the extrusion bevel). */}
        <Lightformer
          form="rect"
          intensity={2.4}
          color="#ffffff"
          position={[0, 4, -8]}
          scale={[10, 5, 1]}
        />
        {/* Faint ground bounce so the underside isn't dead. */}
        <Lightformer
          form="rect"
          intensity={0.5}
          color="#ededed"
          position={[0, -6, 0]}
          scale={[12, 12, 1]}
        />
      </Environment>

      <OrbitControls makeDefault target={frame.center} />
    </Canvas>
  );
}
