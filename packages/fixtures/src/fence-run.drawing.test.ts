/**
 * `fence-run@1` drawing-emitter lock (CAR-32, ADR 0102): the front elevation +
 * section A–A DERIVED from the ONE geometry SoT — the family authors geometry +
 * a small DrawingSpec and inherits its 2D drawing free. Config: the byte-true
 * anchor (LAMELA 113 3D, bay 2000 × 2000, 4 bays).
 */
import { describe, expect, it } from "vitest";

import { deriveInstance } from "@repo/engine";
import { buildSolids, buildTechnicalDrawing, FRONT_VIEW, renderView } from "@repo/renderers";

import { catalogV2 } from "./catalog/catalog-v2.js";
import { fencePrices, lamela_113_3d_ploty } from "./golden/fence-run.js";
import { fenceRunV1 } from "./releases/fence-run.js";

const result = deriveInstance(fenceRunV1, lamela_113_3d_ploty.config, fencePrices, catalogV2);

describe("fence-run@1 — front elevation (ViewProjector)", () => {
  const view = renderView(buildSolids(result), FRONT_VIEW);

  it("projects a non-empty vector elevation, all lines visible (flat run, no occlusion)", () => {
    expect(view.edges.length).toBeGreaterThan(0);
    expect(view.edges.every((e) => e.role === "visible")).toBe(true);
  });

  it("spans the full run (4 bays × 2000) at post width", () => {
    // Posts 100 wide on centrelines 0 / 2000 / … / 8000 → x ∈ [−50, 8050];
    // 2000 tall. The bottom lamella (centred on its Excel slot at y = 49, plank
    // 113 tall) dips ~7 mm below the panel base — FIL-faithful (planks centre on
    // their drill slots), not a datum error.
    expect(view.bbox.min.x).toBe(-50);
    expect(view.bbox.max.x).toBe(8050);
    expect(view.bbox.min.y).toBe(-7);
    expect(view.bbox.max.y).toBe(2000);
  });
});

describe("fence-run@1 — feature-bound dimensions (the Excel-value oracle)", () => {
  const drawing = buildTechnicalDrawing(result, fenceRunV1.drawing);
  const dim = (id: string) => drawing.annotations.find((a) => a.id === id);

  it("prints the ENGINE's derived values on the drawing (Excel fidelity)", () => {
    expect(dim("overall.width")?.valueMm).toBe(8000); // runLength
    expect(dim("overall.height")?.valueMm).toBe(2000); // postLength (clear_height)
    expect(dim("fill.length")?.valueMm).toBe(1930); // lamellaLength (Excel F27)
    expect(dim("fill.pitch")?.valueMm).toBe(94); // fillPitch (Excel J33)
  });

  it("cross-checks the printed value against the derived scope", () => {
    expect(dim("overall.height")?.valueMm).toBe(result.derived.postLength);
    expect(dim("fill.pitch")?.valueMm).toBe(result.derived.fillPitch);
  });

  it("stamps the Excel member letters A–C as labels", () => {
    const labels = drawing.annotations.filter((a) => a.kind === "label");
    expect(labels.map((l) => l.text).sort()).toEqual(["A", "B", "C"]);
  });
});

describe("fence-run@1 — section A–A (honest hatched cross-section)", () => {
  const drawing = buildTechnicalDrawing(result, fenceRunV1.drawing);
  const section = drawing.sections?.find((s) => s.sectionId === "A-A");

  it("emits the authored vertical cut across the first bay centre", () => {
    expect(section).toBeDefined();
    expect(section!.axis).toBe("x");
    expect(section!.offsetMm).toBe(1000);
  });

  it("cuts ONLY the horizontal lamellas the plane crosses (bay-0 stack)", () => {
    // Every upright (posts at bay edges, h-profil carriers at discrete x) runs
    // PARALLEL to the cut and is skipped; the plane crosses the 21 horizontal
    // lamellas of bay 0 transversely.
    const ids = section!.cuts.map((c) => c.sourceId);
    const lamellas = ids.filter((id) => id.startsWith("fill.material/piece["));
    expect(lamellas).toHaveLength(21);
    expect(ids.some((id) => /posts|hprofile/.test(id))).toBe(false);
  });

  it("honestly flags the depth-less lamella cuts (I5, no invented wall)", () => {
    const lamella = section!.cuts.find((c) => c.sourceId.startsWith("fill.material/piece["))!;
    expect(lamella.nominalDepth).toBe(true); // lamela_113 has no d_mm → degraded outline
    expect(section!.dataFillNeeded).toBe(true);
  });
});
