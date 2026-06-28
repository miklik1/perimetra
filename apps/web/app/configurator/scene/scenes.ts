"use client";

/**
 * In-context preset scenes (ADR 0093) — the §8 "visible in-context backdrops"
 * deferred by ADR 0074. Like the finish/explode/section slices this is pure
 * PRESENTATION: a chosen scene swaps the viewport BACKDROP (sky tint + a ground
 * plane + a little context geometry) so the gate reads as installed — on a
 * driveway, a fence line, a garden — instead of floating in a studio. It never
 * touches the engine, BOM, or price (I1/I4).
 *
 * Procedural, NOT a real HDRI (ADR 0074 named the HDRI path, but a self-hosted
 * `.hdr` adds a binary asset + a CSP origin): the backdrop is all-code geometry,
 * the same CSP-clean precedent as the Lightformer studio IBL, which stays.
 *
 * Scene LABELS are product-domain data (the same pattern as the finish labels),
 * not app i18n chrome.
 */
import { create } from "zustand";

type SceneContext = "none" | "pillars" | "fence" | "hedge";

export interface ScenePreset {
  id: string;
  /** Czech domain label (cf. finish labels) — not i18n chrome. */
  label: string;
  /** Canvas background tint. */
  sky: string;
  /** Visible ground plane; `null` = the invisible studio floor (the default). */
  ground: { colorHex: string; roughness: number } | null;
  /** Context geometry the backdrop flanks the gate with. */
  context: SceneContext;
}

/** The curated install contexts. `studio` is the v1 neutral field (default);
 *  the rest place the gate on a coloured ground with light context geometry. */
export const SCENES: ScenePreset[] = [
  { id: "studio", label: "Studio", sky: "#ededed", ground: null, context: "none" },
  {
    id: "prijezd",
    label: "Příjezd",
    sky: "#dfe6ea",
    ground: { colorHex: "#74787c", roughness: 0.9 },
    context: "pillars",
  },
  {
    id: "plot",
    label: "Plot",
    sky: "#dde7ec",
    ground: { colorHex: "#586b3a", roughness: 0.95 },
    context: "fence",
  },
  {
    id: "zahrada",
    label: "Zahrada",
    sky: "#dce6ea",
    ground: { colorHex: "#4d6736", roughness: 0.95 },
    context: "hedge",
  },
];

const DEFAULT_SCENE_ID = "studio";

const byId = new Map(SCENES.map((s) => [s.id, s]));

export function sceneById(id: string): ScenePreset {
  return byId.get(id) ?? byId.get(DEFAULT_SCENE_ID)!;
}

interface SceneState {
  sceneId: string;
  setScene: (id: string) => void;
}

/** The scene slice — the picker writes it, the canvas reads it (sky + backdrop). */
export const useScene = create<SceneState>((set) => ({
  sceneId: DEFAULT_SCENE_ID,
  setScene: (sceneId) => set({ sceneId }),
}));
