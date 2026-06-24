"use client";

import dynamic from "next/dynamic";

import { syntheticGate } from "./synthetic-scene";

/**
 * The headless 3D verification surface (ADR 0073) — renders the configurator's
 * real `SceneCanvas` full-screen against a synthetic gate, so the capture
 * harness sees the actual render pipeline. Dev-only (the route 404s in prod).
 */
const SceneCanvas = dynamic(() => import("../configurator/scene/scene-canvas"), {
  ssr: false,
});

export function SceneLabClient() {
  const scene = syntheticGate();
  return (
    <div data-testid="scene-lab" className="bg-field h-screen w-screen">
      <SceneCanvas scene={scene} />
    </div>
  );
}
