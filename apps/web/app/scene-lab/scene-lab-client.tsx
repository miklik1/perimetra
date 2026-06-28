"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";

import { catalogV1, planka_100_2d_3panel, slidingGateV1 } from "@repo/fixtures";
import type { Catalog } from "@repo/model";

import { deriveForUi } from "../configurator/derive";
import type { CameraView } from "../configurator/scene/camera-poses";
import { useDeviation } from "../configurator/scene/deviation";
import { useFinish } from "../configurator/scene/finish";
import { syntheticGate } from "./synthetic-scene";

/**
 * The headless 3D verification surface (ADR 0073) — renders the configurator's
 * real `SceneCanvas` full-screen, so the capture harness sees the actual render
 * pipeline. Dev-only (the route 404s in prod).
 *
 * Two scene sources (the "compare 3D logic with the actual render" discipline):
 *   ?scene=synthetic    (default) a correct-by-construction gate — proves the
 *                       render path (extrusion, lighting, the §6 amber)
 *   ?scene=sliding-gate the REAL `sliding-gate@1` release derived through the
 *                       engine on the Excel-anchored U34 fixture — proves the
 *                       AUTHORED geometry (catches a floating/misplaced piece a
 *                       synthetic scene can never surface)
 *
 * Query knobs (capture harness + e2e, ADR 0075/0076/0077):
 *   ?finish=<id>     drive the finish slice (e.g. zinek, drevo)
 *   ?highlight=1     turn on deviation highlight (emissive amber + desaturate)
 *   ?cam=<view>      a named camera pose — hero|front|detail|pullback|away
 */
const SceneCanvas = dynamic(() => import("../configurator/scene/scene-canvas"), {
  ssr: false,
});

/** The real Excel-anchored sliding gate, derived through the same engine path
 *  the configurator uses (deriveForUi → deriveInstanceDetailed + buildScene). */
function realSlidingGateScene() {
  const catalogs: ReadonlyMap<string, Catalog> = new Map([[slidingGateV1.id, catalogV1]]);
  const product = { release: slidingGateV1, initialInput: planka_100_2d_3panel.config };
  return deriveForUi(product, planka_100_2d_3panel.config, planka_100_2d_3panel.prices, catalogs)
    .scene;
}

export function SceneLabClient() {
  const setFinish = useFinish((s) => s.setFinish);
  const setHighlight = useDeviation((s) => s.setHighlight);
  const [view, setView] = useState<CameraView>("hero");
  const [source, setSource] = useState<"synthetic" | "sliding-gate">("synthetic");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const finish = params.get("finish");
    if (finish !== null && finish !== "") setFinish(finish);
    if (params.get("highlight") === "1") setHighlight(true);
    if (params.get("scene") === "sliding-gate") setSource("sliding-gate");
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

  const realScene = useMemo(
    () => (source === "sliding-gate" ? realSlidingGateScene() : undefined),
    [source],
  );
  const scene = source === "sliding-gate" ? realScene : syntheticGate();

  return (
    <div data-testid="scene-lab" className="bg-field h-screen w-screen">
      {scene === undefined ? (
        <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
          no scene (invalid derivation)
        </div>
      ) : (
        <SceneCanvas scene={scene} view={view} />
      )}
    </div>
  );
}
