"use client";

import { Grid, OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { useMemo } from "react";
import { ACESFilmicToneMapping, SRGBColorSpace } from "three";

import type { Scene3D } from "@repo/renderers";

import { frameScene } from "./frame";
import { SceneRenderer } from "./scene-renderer";

/**
 * The 3D playground canvas (gates' camera/lighting recipe, minus drei's
 * <Environment> — its preset HDRs load from a CDN the strict CSP rightly
 * blocks). World units are mm, hence the far plane; the parent remounts this
 * component per release (key=), so the initial camera pose simply fits the
 * first derivation and OrbitControls owns it from there.
 */
export default function SceneCanvas({ scene }: { scene: Scene3D }) {
  const frame = useMemo(() => frameScene(scene), [scene]);
  return (
    <Canvas
      gl={{
        antialias: true,
        toneMapping: ACESFilmicToneMapping,
        toneMappingExposure: 1.4,
        outputColorSpace: SRGBColorSpace,
      }}
      camera={{ fov: 45, near: 10, far: 120000, position: frame.cameraPosition }}
      dpr={[1, 2]}
    >
      <color attach="background" args={["#dde3ea"]} />
      <ambientLight intensity={0.9} />
      <hemisphereLight args={["#ffffff", "#5a6470", 0.6]} />
      <directionalLight position={[5000, 8000, 6000]} intensity={1.3} />
      <directionalLight position={[-4000, 5000, -3000]} intensity={0.7} />
      <SceneRenderer scene={scene} />
      <Grid
        args={[20000, 20000]}
        cellSize={500}
        sectionSize={1000}
        position={[frame.center[0], 0, frame.center[2]]}
        fadeDistance={frame.radius * 6}
        infiniteGrid
      />
      <OrbitControls makeDefault target={frame.center} />
    </Canvas>
  );
}
