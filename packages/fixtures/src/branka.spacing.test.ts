/**
 * `branka@1` geometry + Výplet-spacing lock (drawing-spike prototype, 2026-07-08).
 *
 * The member chain and fill spacing are HAND-DERIVED from the Excel FORMULAS
 * (`~/gates/reference_files_unlocked/2026-PC_Branky_FINAL_PC.xlsx`, `Kalkulace`,
 * 1xSP = sDP/BnS both FALSE) — NOT copied from engine output. This is the byte-
 * true-to-Excel geometry anchor the drawing emitter derives from.
 *
 * Chain (clear_width 1000, clear_height 1500, PLAŇKA 100 2D):
 *   stileLength = 1500 − 100 = 1400      railLength = 1000 − 90 = 910
 *   latchPost   = 1500 − 30  = 1470      fillSlat   = 910 − 130 = 780
 *   hProfile    = 1400 − 106 = 1294
 *   fillCount   = floor(1294 / 101) − 1 = 12 − 1 = 11
 *   fillGaps    = 10
 *   rawPitch    = floor((1294 − 10 − 10) / 10) = floor(127.4) = 127
 *   pitch       = 127 (disable_max: PLAŇKA 2D)
 *   remainder   = 1294 − 10·127 − 10 − 10 = 4
 *   offset1     = 10 + roundUp(4 / 2) = 12
 *   slat i at.y = fillBaseY + offset1 + i·pitch, fillBaseY = 60 + (1400−1294)/2 = 113
 */
import { describe, expect, it } from "vitest";

import { deriveInstance, deriveSite } from "@repo/engine";
import type { ConfigInput } from "@repo/engine";
import type { Catalog, Site } from "@repo/model";
import { validateRelease } from "@repo/model";
import { buildScene } from "@repo/renderers";

import { catalogV4 } from "./catalog/catalog-v4.js";
import { brankaPrices, planka_100_2d_1xsp } from "./golden/branka.js";
import { brankaV1 } from "./releases/branka.js";

const config: ConfigInput = planka_100_2d_1xsp.config;

describe("branka@1 — publishes clean (I2 gate)", () => {
  it("validateRelease returns no defects", () => {
    expect(validateRelease(brankaV1, catalogV4)).toEqual([]);
  });
});

describe("branka@1 — Excel member chain (Kalkulace 1xSP)", () => {
  const result = deriveInstance(brankaV1, config, brankaPrices, catalogV4);

  it("derives valid (no error issue)", () => {
    expect(result.isValid).toBe(true);
    expect(result.issues.filter((i) => i.severity === "error")).toHaveLength(0);
  });

  it("pins the frame member lengths", () => {
    expect(result.derived.stileLength).toBe(1400);
    expect(result.derived.railLength).toBe(910);
    expect(result.derived.latchPostLength).toBe(1470);
    expect(result.derived.fillSlatLength).toBe(780);
    expect(result.derived.hProfileLength).toBe(1294);
  });

  it("pins the Excel Výplet spacing chain (K19/J20/H20)", () => {
    expect({
      count: result.derived.fillCount,
      gaps: result.derived.fillGaps,
      rawPitch: result.derived.fillRawPitch,
      pitch: result.derived.fillPitch,
      remainder: result.derived.fillRemainder,
      offset1: result.derived.fillOffset1,
    }).toEqual({ count: 11, gaps: 10, rawPitch: 127, pitch: 127, remainder: 4, offset1: 12 });
  });
});

// --- Physical placement: the derived chain actually reaches the scene pieces ---

const PREVIEW = "preview";
const previewSite: Site = {
  id: "branka-golden",
  terrain: [],
  placements: [{ instanceId: PREVIEW, pose: { origin_mm: { x: 0, y: 0 } } }],
  connections: [],
};

function scenePieces() {
  const catalogs: ReadonlyMap<string, Catalog> = new Map([[brankaV1.id, catalogV4]]);
  const result = deriveSite(
    previewSite,
    [{ instanceId: PREVIEW, release: brankaV1, input: config }],
    brankaPrices,
    catalogs,
  );
  if (!result.isValid) throw new Error("branka must derive valid");
  return buildScene(previewSite, result).instances[0]!.pieces;
}

describe("branka@1 — scene geometry (buildScene)", () => {
  const pieces = scenePieces();

  it("emits the five frame L-pieces + 2 h-profils + 11 slats", () => {
    const frame = pieces.filter((p) => p.id.includes("/frame.lprofile/"));
    const hprof = pieces.filter((p) => p.id.includes("/frame.hprofile/"));
    const slats = pieces.filter((p) => p.id.includes("/fill.material/piece["));
    expect(frame).toHaveLength(5); // 2 stiles + 2 rails + latch post
    expect(hprof).toHaveLength(2);
    expect(slats).toHaveLength(11);
  });

  it("stacks the slats from fillBaseY+offset1, stepping by pitch", () => {
    const ys = [
      ...new Set(pieces.filter((p) => p.id.includes("/fill.material/piece[")).map((p) => p.at[1])),
    ].sort((a, b) => a - b);
    expect(ys).toHaveLength(11);
    expect(ys[0]).toBe(113 + 12); // fillBaseY + offset1 = 125
    expect(ys[1]! - ys[0]!).toBe(127); // pitch
    // The whole stack fits under the h-profil carrier top.
    const carrierTop = 113 + 1294;
    expect(ys[ys.length - 1]!).toBeLessThanOrEqual(carrierTop);
  });
});
