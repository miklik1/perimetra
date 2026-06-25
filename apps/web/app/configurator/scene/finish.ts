"use client";

/**
 * The finish / colour / material swap (ADR 0075, technique 3 — the Bombardier
 * "Stripe Colour" analog, done for real). Bombardier swapped a pre-rendered PNG
 * per swatch (a spinner each time); Perimetra recolours the SAME live mesh with a
 * synchronous React prop update — no raster, no CDN fetch, no latency. That gap
 * is the product's visible differentiator.
 *
 * A finish is PRESENTATION, not engine data: the golden release carries no colour
 * parameter (a powder-coat RAL is a cosmetic choice, not a structural one), so the
 * chosen finish lives in this `zustand` slice and the scene renderer reads it to
 * override each piece's PBR material. The §6 deviation amber stays ABOVE the
 * finish (a deviated piece is amber regardless of the chosen colour) — see
 * `scene-renderer.tsx`.
 *
 * RAL hexes are INDICATIVE swatches (a screen under ACES tone-mapping is not a
 * physical sample) — the picker carries the "barva orientační — potvrďte dle
 * vzorku" caveat (Direction §7). Finish NAMES are product-domain data on the
 * option (the same pattern as the release's authored option-set labels), not app
 * i18n chrome.
 */
import { CanvasTexture, RepeatWrapping, SRGBColorSpace, type Texture } from "three";
import { create } from "zustand";

export interface FinishMaterial {
  /** sRGB hex; three converts to linear under the ACES pipeline (scene-canvas). */
  colorHex: string;
  metalness: number;
  roughness: number;
  /** Attach the procedural wood-grain map (dřevodekor). */
  wood?: boolean;
}

export interface FinishOption {
  id: string;
  /** Czech product label — domain DATA (cf. the release's option-set labels),
   *  not app i18n chrome. */
  label: string;
  /** UI swatch fill (a metallic's chip differs from its lit material colour). */
  swatch: string;
  /** RAL reference shown under a powder swatch — indicative only. */
  ral?: string;
  material: FinishMaterial;
}

/**
 * Curated CZ-market finishes. Powder colours (RAL) are matte and colour-led;
 * `zinek` (žárový zinek) is bright metal carried by metalness/roughness; `drevo`
 * (dřevodekor) is a procedural grain map. Real fabricators powder-coat to RAL or
 * hot-dip galvanise — this is the honest short list, not a paint fan deck.
 */
export const FINISHES: FinishOption[] = [
  {
    id: "antracit",
    label: "Antracit",
    ral: "RAL 7016",
    swatch: "#383e42",
    material: { colorHex: "#383e42", metalness: 0.18, roughness: 0.55 },
  },
  {
    id: "cerna",
    label: "Černá",
    ral: "RAL 9005",
    swatch: "#16171a",
    material: { colorHex: "#16171a", metalness: 0.2, roughness: 0.5 },
  },
  {
    id: "bila",
    label: "Bílá",
    ral: "RAL 9016",
    swatch: "#f1f0ea",
    material: { colorHex: "#f1f0ea", metalness: 0.05, roughness: 0.66 },
  },
  {
    id: "seda",
    label: "Šedá",
    ral: "RAL 7035",
    swatch: "#c5c7c4",
    material: { colorHex: "#c5c7c4", metalness: 0.1, roughness: 0.6 },
  },
  {
    id: "zelena",
    label: "Zelená",
    ral: "RAL 6005",
    swatch: "#2f4538",
    material: { colorHex: "#2f4538", metalness: 0.15, roughness: 0.55 },
  },
  {
    id: "hneda",
    label: "Hnědá",
    ral: "RAL 8017",
    swatch: "#45322e",
    material: { colorHex: "#45322e", metalness: 0.15, roughness: 0.55 },
  },
  {
    id: "modra",
    label: "Modrá",
    ral: "RAL 5010",
    swatch: "#13366b",
    material: { colorHex: "#13366b", metalness: 0.15, roughness: 0.55 },
  },
  {
    id: "zinek",
    label: "Žárový zinek",
    swatch: "#c4c9cd",
    // Hot-dip galvanised is a light, semi-matte cool metal. The studio IBL is
    // intentionally dim (background={false}, ADR 0074), so a near-mirror
    // metalness reflects black and crushes toward anthracite — keep metalness
    // moderate so the light albedo carries the "bright zinc" read, with enough
    // sheen for a metallic specular off the key light.
    material: { colorHex: "#c4c9cd", metalness: 0.55, roughness: 0.42 },
  },
  {
    id: "drevo",
    label: "Dřevodekor",
    swatch: "#9b6b3f",
    material: { colorHex: "#caa472", metalness: 0.0, roughness: 0.72, wood: true },
  },
];

/** Anthracite (RAL 7016) powder-coat — the most common modern CZ gate finish. */
const DEFAULT_FINISH_ID = "antracit";

const byId = new Map(FINISHES.map((f) => [f.id, f]));

export function finishById(id: string): FinishOption {
  return byId.get(id) ?? byId.get(DEFAULT_FINISH_ID)!;
}

interface FinishState {
  finishId: string;
  setFinish: (id: string) => void;
}

/** The finish slice — a single source of truth the renderer reads and the picker
 *  writes (Direction: "a zustand finish slice = a synchronous React prop update"). */
export const useFinish = create<FinishState>((set) => ({
  finishId: DEFAULT_FINISH_ID,
  setFinish: (finishId) => set({ finishId }),
}));

/**
 * The procedural wood-grain `CanvasTexture` (dřevodekor) — built once, lazily, in
 * the browser only. No binary asset and no external fetch (CSP-clean), matching
 * ADR 0074's procedural-over-binary precedent for the studio IBL; a real photo
 * map can swap in later behind this same accessor. Deterministic (no
 * `Math.random`) so the headless capture is byte-stable. Returns `null` under SSR
 * / jsdom (no `document`), where the renderer simply omits the map.
 */
let woodTex: Texture | null = null;
export function woodTexture(): Texture | null {
  if (woodTex !== null) return woodTex;
  if (typeof document === "undefined") return null;
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx === null) return null;

  // Warm base, then vertical grain streaks (the grain runs along the bar length).
  ctx.fillStyle = "#b07d4e";
  ctx.fillRect(0, 0, size, size);
  for (let x = 0; x < size; x += 1) {
    // Layered sines → soft, irregular grain bands without RNG.
    const g =
      Math.sin(x * 0.18) * 0.5 +
      Math.sin(x * 0.043 + 1.3) * 0.32 +
      Math.sin(x * 0.011 + 4.1) * 0.18;
    const shade = Math.round(40 * g);
    const r = 176 + shade;
    const gr = 125 + Math.round(shade * 0.8);
    const b = 78 + Math.round(shade * 0.6);
    ctx.strokeStyle = `rgb(${r}, ${gr}, ${b})`;
    ctx.beginPath();
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, size);
    ctx.stroke();
  }

  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.repeat.set(2, 2);
  woodTex = tex;
  return tex;
}
