"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";

import type { ConfigInput, PriceTable } from "@repo/engine";
import {
  catalogV1,
  catalogV2,
  catalogV3,
  fencePrices,
  fenceRunV1,
  lamela_113_2d_3panel,
  lamela_113_3d_2panel,
  lamela_120_3d_3panel,
  planka_100_2d_3panel,
  planka_100_3d_3panel,
  planka_120_2d_3panel,
  planka_120_3d_3panel,
  planka_120_3d_vzor,
  slidingGateV1,
  swingGateV1,
} from "@repo/fixtures";
import { DEFAULT_ROUNDING_POLICY, type Catalog } from "@repo/model";

import { deriveForUi } from "../configurator/derive";
import type { ConfiguratorPricing } from "../configurator/products";
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
 *   ?scene=fence-run    the REAL `fence-run@1` release (CAR-32) at the canonical
 *                       bay — eyes-on the FIL Ploty fence geometry per fill type
 *   ?scene=swing-gate   the REAL `swing-gate@1` release (CAR-33) at the Excel
 *                       VZOR — eyes-on the double-leaf assembly (leaves · astragal
 *                       · divider · hinge posts · two plank bands)
 *
 * Query knobs (capture harness + e2e, ADR 0075/0076/0077):
 *   ?finish=<id>       drive the finish slice (e.g. zinek, drevo)
 *   ?highlight=1       turn on deviation highlight (emissive amber + desaturate)
 *   ?cam=<view>        a named camera pose — hero|front|detail|pullback|away
 *   ?fill_type_id=<id> render a specific Výplet fill in its own golden config
 *                      (eyes-on the 7 fills; default is the U34 planka_100_2d)
 */
const SceneCanvas = dynamic(() => import("../configurator/scene/scene-canvas"), {
  ssr: false,
});

/**
 * The lab derives for GEOMETRY only — it renders scenes and never shows money —
 * so it pins the default rounding policy and carries no cost layer (ADR 0116).
 * Stated explicitly rather than defaulted, because the whole point of
 * `ConfiguratorPricing` is that no caller silently inherits a policy: a lab that
 * does not care must still say so.
 */
const labPricing = (table: PriceTable): ConfiguratorPricing => ({
  table,
  cost: null,
  marginFloorPct: null,
  rounding: DEFAULT_ROUNDING_POLICY,
});

/** The real Excel-anchored sliding gate, derived through the same engine path
 *  the configurator uses (deriveForUi → deriveInstanceDetailed + buildScene). */
/** The 7 Výplet fill types, each in its OWN validated golden config — the
 *  regression fills were authored on a different base than the U34/5m anchors,
 *  so forcing them onto one config invalidates the derivation (empty scene). */
const fillGoldens = {
  planka_100_2d: planka_100_2d_3panel,
  planka_100_3d: planka_100_3d_3panel,
  lamela_113_2d: lamela_113_2d_3panel,
  lamela_113_3d: lamela_113_3d_2panel,
  lamela_120_3d: lamela_120_3d_3panel,
  planka_120_2d: planka_120_2d_3panel,
  planka_120_3d: planka_120_3d_3panel,
} as const;

function realSlidingGateScene(fillTypeId?: string) {
  const catalogs: ReadonlyMap<string, Catalog> = new Map([[slidingGateV1.id, catalogV1]]);
  const golden =
    (fillTypeId ? fillGoldens[fillTypeId as keyof typeof fillGoldens] : undefined) ??
    planka_100_2d_3panel;
  const product = { release: slidingGateV1, initialInput: golden.config, catalogVersion: 1 };
  return deriveForUi(product, golden.config, labPricing(golden.prices), catalogs).scene;
}

/** The REAL `swing-gate@1` (CAR-33) at the Excel VZOR (two-leaf / divided /
 *  on-posts, 3.0 × 1.5 m) — eyes-on the double-leaf assembly derived through the
 *  same engine path the configurator uses. */
function realSwingGateScene() {
  const catalogs: ReadonlyMap<string, Catalog> = new Map([[swingGateV1.id, catalogV3]]);
  const config = planka_120_3d_vzor.config;
  const product = { release: swingGateV1, initialInput: config, catalogVersion: 3 };
  return deriveForUi(product, config, labPricing(planka_120_3d_vzor.prices), catalogs).scene;
}

/** The REAL `fence-run@1` (CAR-32) at the canonical bay (2000 × 2000, 4 bays),
 *  any of the 7 Výplet fills — eyes-on the FIL Ploty geometry (posts · h-profil
 *  carriers · stacked horizontal lamellas) per fill type. */
function realFenceScene(fillTypeId?: string) {
  const catalogs: ReadonlyMap<string, Catalog> = new Map([[fenceRunV1.id, catalogV2]]);
  const config: ConfigInput = {
    run_length_mm: 8000,
    clear_height_mm: 2000,
    fill_type_id: fillTypeId ?? "lamela_113_3d",
    frame_material: "alu",
    include_installation: true,
  };
  const product = { release: fenceRunV1, initialInput: config, catalogVersion: 2 };
  return deriveForUi(product, config, labPricing(fencePrices), catalogs).scene;
}

export function SceneLabClient() {
  const setFinish = useFinish((s) => s.setFinish);
  const setHighlight = useDeviation((s) => s.setHighlight);
  const [view, setView] = useState<CameraView>("hero");
  const [source, setSource] = useState<"synthetic" | "sliding-gate" | "fence-run" | "swing-gate">(
    "synthetic",
  );
  const [fillTypeId, setFillTypeId] = useState<string | undefined>();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const finish = params.get("finish");
    if (finish !== null && finish !== "") setFinish(finish);
    if (params.get("highlight") === "1") setHighlight(true);
    const sceneParam = params.get("scene");
    if (sceneParam === "sliding-gate") setSource("sliding-gate");
    else if (sceneParam === "fence-run") setSource("fence-run");
    else if (sceneParam === "swing-gate") setSource("swing-gate");
    const fill = params.get("fill_type_id");
    if (fill !== null && fill !== "") setFillTypeId(fill);
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

  const realScene = useMemo(() => {
    if (source === "sliding-gate") return realSlidingGateScene(fillTypeId);
    if (source === "fence-run") return realFenceScene(fillTypeId);
    if (source === "swing-gate") return realSwingGateScene();
    return undefined;
  }, [source, fillTypeId]);
  const scene = source === "synthetic" ? syntheticGate() : realScene;

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
