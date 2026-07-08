/**
 * `branka@1` drawing-emitter geometry lock (spike, 2026-07-08) — the SolidModeler
 * + ViewProjector half of the pipeline, on the verified byte-true branka geometry.
 * Proves the 2D front elevation is DERIVED from the one geometry SoT (no separate
 * 2D model): 18 pieces → role-tagged solids → an orthographic vector elevation.
 *
 * Expected front elevation (config PLAŇKA 100 2D · 1xSP · 1000×1500):
 *   left stile   x∈[−25,25]   y∈[60,1460]     right stile x∈[885,935]
 *   bottom rail  x∈[0,910]    y∈[35,85]        top rail    y∈[1435,1485]
 *   latch post   x∈[975,1025] y∈[0,1470]       (grounded, clear_height−30)
 *   2 h-profils  vertical @ x 65 / 845          11 slats    100-tall horizontal bands
 *   overall bbox x∈[−25,1025] y∈[0,1485]
 */
import { describe, expect, it } from "vitest";

import { deriveInstance } from "@repo/engine";
import { buildSolids, buildTechnicalDrawing, FRONT_VIEW, renderView } from "@repo/renderers";

import { catalogV1 } from "./catalog/catalog-v1.js";
import { brankaPrices, planka_100_2d_1xsp } from "./golden/branka.js";
import { brankaV1 } from "./releases/branka.js";

const result = deriveInstance(brankaV1, planka_100_2d_1xsp.config, brankaPrices, catalogV1);

describe("branka@1 — SolidModeler", () => {
  const solids = buildSolids(result);

  it("expands every geometry piece to a solid (5 frame + 2 h-profil + 11 slats)", () => {
    expect(solids).toHaveLength(18);
    expect(solids.filter((s) => s.id.startsWith("frame.lprofile/"))).toHaveLength(5);
    expect(solids.filter((s) => s.id.startsWith("frame.hprofile/"))).toHaveLength(2);
    expect(solids.filter((s) => s.id.startsWith("fill.material/"))).toHaveLength(11);
  });

  it("gives L-profile pieces a 3D box (front+back+ribs) and flats a planar face", () => {
    const stile = solids.find((s) => s.id === "frame.lprofile/stileLeft")!;
    const slat = solids.find((s) => s.id === "fill.material/piece[0]")!;
    expect(stile.edges).toHaveLength(12); // real depth (L50x50 has d_mm) → box
    expect(slat.edges).toHaveLength(4); // planka_100 has no d_mm → planar front face
  });

  it("carries I9-stable edge ids + section outlines", () => {
    const stile = solids.find((s) => s.id === "frame.lprofile/stileLeft")!;
    expect(stile.edges[0]!.id).toBe("frame.lprofile/stileLeft#F0");
    expect(stile.section.outer).toHaveLength(4);
  });
});

describe("branka@1 — front elevation (ViewProjector)", () => {
  const view = renderView(buildSolids(result), FRONT_VIEW);

  it("projects a non-empty vector elevation, all lines visible (flat leaf, no occlusion)", () => {
    expect(view.edges.length).toBeGreaterThan(0);
    expect(view.edges.every((e) => e.role === "visible")).toBe(true);
  });

  it("dedups box front/back faces (no doubled lines) — a box contributes one rectangle", () => {
    const stileEdges = view.edges.filter((e) => e.sourceId.startsWith("frame.lprofile/stileLeft#"));
    // Front + back rectangle dedup to 4 unique segments; the 4 depth ribs are
    // head-on degenerate and dropped.
    expect(stileEdges).toHaveLength(4);
  });

  it("spans the leaf + grounded latch post (bbox mm)", () => {
    expect(view.bbox.min).toEqual({ x: -25, y: 0 });
    expect(view.bbox.max).toEqual({ x: 1025, y: 1485 });
  });

  it("stacks 11 horizontal slat bands at the derived pitch (125 + i·127)", () => {
    // Each slat's two long edges sit at band-centre ± 50 (profile half-width).
    const slatLongYs = view.edges
      .filter((e) => e.sourceId.startsWith("fill.material/piece[") && e.from.y === e.to.y)
      .map((e) => e.from.y);
    const centres = [...new Set(slatLongYs)].sort((a, b) => a - b);
    // 11 bands × 2 long edges (top+bottom of each) = 22 distinct y-lines.
    expect(centres).toHaveLength(22);
    expect(centres[0]).toBe(75); // first band centre 125 − 50
    expect(centres[centres.length - 1]).toBe(1445); // last band centre 1395 + 50
  });
});

describe("branka@1 — feature-bound dimensions (the Excel-value oracle)", () => {
  const drawing = buildTechnicalDrawing(result, brankaV1.drawing);
  const dim = (id: string) => drawing.annotations.find((a) => a.id === id);

  it("prints the ENGINE's derived values on the drawing (Excel fidelity)", () => {
    // Each dimension's printed mm is the derived key, NOT a re-measured projection
    // — so the drawing cannot print a number that disagrees with the derivation.
    expect(dim("overall.width")?.valueMm).toBe(910); // railLength
    expect(dim("overall.height")?.valueMm).toBe(1400); // stileLength
    expect(dim("latch.height")?.valueMm).toBe(1470); // latchPostLength
    expect(dim("fill.slat.length")?.valueMm).toBe(780); // fillSlatLength
    expect(dim("fill.pitch")?.valueMm).toBe(127); // fillPitch
  });

  it("cross-checks the printed value against the derived scope", () => {
    expect(dim("overall.height")?.valueMm).toBe(result.derived.stileLength);
    expect(dim("fill.pitch")?.valueMm).toBe(result.derived.fillPitch);
  });

  it("lays out the 11-slat chain with a tick per slat (ladder dim)", () => {
    expect(dim("fill.pitch")?.ticks).toHaveLength(11);
    // consecutive ticks step by the pitch (127) along the vertical dim line.
    const ys = dim("fill.pitch")!.ticks!.map((t) => t.y);
    expect(ys[1]! - ys[0]!).toBe(127);
  });

  it("stamps the Excel member letters A–D as labels", () => {
    const labels = drawing.annotations.filter((a) => a.kind === "label");
    expect(labels.map((l) => l.text).sort()).toEqual(["A", "B", "C", "D"]);
  });

  it("auto-places dimensions with witness lines, no hand-layout", () => {
    const w = dim("overall.width")!;
    expect(w.witness).toHaveLength(2);
    expect(w.line.from.y).toBeLessThan(0); // dropped below the leaf (bbox.min.y = 0)
    expect(w.textAt).toBeDefined();
  });
});
