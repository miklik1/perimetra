"use client";

import dynamic from "next/dynamic";
import { useEffect } from "react";

import { useFinish } from "../configurator/scene/finish";
import { syntheticGate } from "./synthetic-scene";

/**
 * The headless 3D verification surface (ADR 0073) — renders the configurator's
 * real `SceneCanvas` full-screen against a synthetic gate, so the capture
 * harness sees the actual render pipeline. Dev-only (the route 404s in prod).
 *
 * `?finish=<id>` drives the finish slice (ADR 0075) so the capture harness can
 * screenshot each colour/material against the real pipeline (e.g.
 * `/scene-lab?finish=zinek`).
 */
const SceneCanvas = dynamic(() => import("../configurator/scene/scene-canvas"), {
  ssr: false,
});

export function SceneLabClient() {
  const setFinish = useFinish((s) => s.setFinish);

  useEffect(() => {
    const finish = new URLSearchParams(window.location.search).get("finish");
    if (finish !== null && finish !== "") setFinish(finish);
  }, [setFinish]);

  const scene = syntheticGate();
  return (
    <div data-testid="scene-lab" className="bg-field h-screen w-screen">
      <SceneCanvas scene={scene} />
    </div>
  );
}
