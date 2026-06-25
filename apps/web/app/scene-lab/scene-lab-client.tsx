"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

import { useDeviation } from "../configurator/scene/deviation";
import { useFinish } from "../configurator/scene/finish";
import { syntheticGate } from "./synthetic-scene";

/**
 * The headless 3D verification surface (ADR 0073) — renders the configurator's
 * real `SceneCanvas` full-screen against a synthetic gate, so the capture
 * harness sees the actual render pipeline. Dev-only (the route 404s in prod).
 *
 * Query knobs for the capture harness + e2e (ADR 0075/0076):
 *   ?finish=<id>     drive the finish slice (e.g. zinek, drevo)
 *   ?highlight=1     turn on deviation highlight (emissive amber + desaturate)
 *   ?cam=away        point the camera away so the deviated piece is off-screen
 *                    (the §6 edge-marker e2e — `deviation.spec.ts`)
 */
const SceneCanvas = dynamic(() => import("../configurator/scene/scene-canvas"), {
  ssr: false,
});

export function SceneLabClient() {
  const setFinish = useFinish((s) => s.setFinish);
  const setHighlight = useDeviation((s) => s.setHighlight);
  const [cam, setCam] = useState<"default" | "away">("default");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const finish = params.get("finish");
    if (finish !== null && finish !== "") setFinish(finish);
    if (params.get("highlight") === "1") setHighlight(true);
    if (params.get("cam") === "away") setCam("away");
  }, [setFinish, setHighlight]);

  const scene = syntheticGate();
  return (
    <div data-testid="scene-lab" className="bg-field h-screen w-screen">
      <SceneCanvas scene={scene} cam={cam} />
    </div>
  );
}
