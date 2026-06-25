"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

import type { CameraView } from "../configurator/scene/camera-poses";
import { useDeviation } from "../configurator/scene/deviation";
import { useFinish } from "../configurator/scene/finish";
import { syntheticGate } from "./synthetic-scene";

/**
 * The headless 3D verification surface (ADR 0073) — renders the configurator's
 * real `SceneCanvas` full-screen against a synthetic gate, so the capture
 * harness sees the actual render pipeline. Dev-only (the route 404s in prod).
 *
 * Query knobs for the capture harness + e2e (ADR 0075/0076/0077):
 *   ?finish=<id>     drive the finish slice (e.g. zinek, drevo)
 *   ?highlight=1     turn on deviation highlight (emissive amber + desaturate)
 *   ?cam=<view>      a named camera pose — hero|front|detail|pullback|away
 *                    (`away` = the §6 off-screen edge-marker e2e)
 */
const SceneCanvas = dynamic(() => import("../configurator/scene/scene-canvas"), {
  ssr: false,
});

export function SceneLabClient() {
  const setFinish = useFinish((s) => s.setFinish);
  const setHighlight = useDeviation((s) => s.setHighlight);
  const [view, setView] = useState<CameraView>("hero");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const finish = params.get("finish");
    if (finish !== null && finish !== "") setFinish(finish);
    if (params.get("highlight") === "1") setHighlight(true);
    const cam = params.get("cam");
    if (
      cam === "hero" ||
      cam === "front" ||
      cam === "detail" ||
      cam === "pullback" ||
      cam === "away"
    ) {
      setView(cam);
    }
  }, [setFinish, setHighlight]);

  const scene = syntheticGate();
  return (
    <div data-testid="scene-lab" className="bg-field h-screen w-screen">
      <SceneCanvas scene={scene} view={view} />
    </div>
  );
}
