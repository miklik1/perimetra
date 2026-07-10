"use client";

import { useMemo } from "react";

import { deriveInstance } from "@repo/engine";
import {
  brankaPrices,
  brankaV1,
  catalogV1,
  catalogV2,
  fencePrices,
  fenceRunV1,
  lamela_113_3d_ploty,
  planka_100_2d_1xsp,
} from "@repo/fixtures";
import { buildTechnicalDrawing, type TechnicalDrawing } from "@repo/renderers";

import { TechnicalDrawingSvg } from "../quotes/[id]/production/technical-drawing-svg";

/**
 * The headless 2D verification surface (ADR 0102) — renders the real
 * `TechnicalDrawingSvg` full-screen off a fixture family derived through the
 * engine, so the capture harness sees the actual emitter → SVG pipeline. Dev-only
 * (the route 404s in prod).
 *
 * Two families (`?scene=`, resolved server-side in `page.tsx`):
 *   branka     (default) `branka@1` on the Excel PLAŇKA 100 2D · 1xSP anchor
 *              — 5-member leaf + 11 slats, section A–A (real rails + honest
 *              nominal-depth slat cuts)
 *   fence-run  `fence-run@1` on the Ploty LAMELA 113 3D bay anchor — posts,
 *              carriers, stacked lamellas, section A–A across the first bay
 */
export type Family = "branka" | "fence-run";

function brankaDrawing(): TechnicalDrawing {
  const result = deriveInstance(brankaV1, planka_100_2d_1xsp.config, brankaPrices, catalogV1);
  return buildTechnicalDrawing(result, brankaV1.drawing);
}

function fenceDrawing(): TechnicalDrawing {
  const result = deriveInstance(fenceRunV1, lamela_113_3d_ploty.config, fencePrices, catalogV2);
  return buildTechnicalDrawing(result, fenceRunV1.drawing);
}

export function DrawingLabClient({ family }: { family: Family }) {
  const drawing = useMemo(
    () => (family === "fence-run" ? fenceDrawing() : brankaDrawing()),
    [family],
  );

  return (
    <div data-testid="drawing-lab" className="h-screen w-screen bg-white p-6">
      <TechnicalDrawingSvg drawing={drawing} className="h-full w-full" />
    </div>
  );
}
