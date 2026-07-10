import { describe, expect, it } from "vitest";

import type { PlacedAnnotation, SectionView, TechnicalDrawing } from "@repo/renderers";

import {
  annotationPoints,
  dimensionText,
  elevationBounds,
  placeSections,
  technicalDrawingFrame,
  viewFrame,
} from "./technical-drawing-frame";

/** A minimal drawing whose one dimension sits BELOW and LEFT of the part, so the
 *  annotation geometry extends past `drawing.bbox` on both axes. */
const DIM: PlacedAnnotation = {
  id: "overall.width",
  kind: "dimension",
  valueMm: 100.4,
  label: "Celková šířka",
  line: { from: { x: 0, y: -140 }, to: { x: 100, y: -140 } },
  witness: [
    { from: { x: 0, y: 0 }, to: { x: 0, y: -140 } },
    { from: { x: 100, y: 0 }, to: { x: 100, y: -140 } },
  ],
  textAt: { x: 50, y: -170 },
};

const SECTION: SectionView = {
  sectionId: "A-A",
  axis: "x",
  offsetMm: 50,
  cuts: [
    {
      sourceId: "c1",
      componentCode: "X",
      outline: [
        { x: -20, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 40 },
        { x: -20, y: 40 },
      ],
      nominalDepth: false,
    },
  ],
  bbox: { min: { x: -20, y: 0 }, max: { x: 20, y: 40 } },
  dataFillNeeded: false,
};

const DRAWING: TechnicalDrawing = {
  viewId: "front",
  edges: [
    { id: "e1", sourceId: "p#0", role: "visible", from: { x: 0, y: 0 }, to: { x: 100, y: 0 } },
    { id: "e2", sourceId: "p#1", role: "visible", from: { x: 100, y: 0 }, to: { x: 100, y: 200 } },
  ],
  annotations: [DIM],
  bbox: { min: { x: 0, y: 0 }, max: { x: 100, y: 200 } },
  sections: [SECTION],
};

describe("elevationBounds — the union includes annotation geometry", () => {
  it("extends past drawing.bbox to enclose the dimension line + text", () => {
    const b = elevationBounds(DRAWING);
    // The dimension line/text sit below the part (y −140 / −170); the part bbox
    // min.y is 0. Framing on the part alone would clip them.
    expect(b.min.y).toBe(-170);
    expect(b.min.x).toBe(0);
    expect(b.max.x).toBe(100);
    expect(b.max.y).toBe(200);
  });
});

describe("viewFrame — the mm→svg transform (Y-flip + padded viewBox)", () => {
  const box = { min: { x: 0, y: 0 }, max: { x: 100, y: 200 } };

  it("flips Y with slope −1 about the padded top edge", () => {
    const { sy } = viewFrame(box);
    // A step up in drawing-y is an equal step down in svg-y.
    expect(sy(200) - sy(0)).toBeCloseTo(-200);
    expect(sy(200)).toBeLessThan(sy(0));
  });

  it("emits a viewBox pinned to min-y 0 whose width/height exceed the span", () => {
    const { viewBox, unit } = viewFrame(box);
    const parts = viewBox.split(" ").map(Number);
    expect(parts).toHaveLength(4);
    const [minX, minY, w, h] = parts as [number, number, number, number];
    expect(minY).toBe(0);
    expect(minX).toBeLessThan(0); // padded left of the part
    expect(w).toBeGreaterThan(100);
    expect(h).toBeGreaterThan(200);
    expect(unit).toBe(Math.max(w, h));
  });
});

describe("annotationPoints — every point an annotation contributes to the frame", () => {
  it("includes the dimension line, witness endpoints and text anchor", () => {
    const pts = annotationPoints(DIM);
    expect(pts).toContainEqual({ x: 50, y: -170 }); // textAt (below the part)
    expect(pts).toContainEqual({ x: 0, y: -140 }); // line.from / witness end
    expect(pts).toContainEqual({ x: 100, y: 0 }); // a witness anchor on the part
  });

  it("includes chain ticks so the frame encloses them", () => {
    const chain: PlacedAnnotation = {
      id: "fill.pitch",
      kind: "chain",
      valueMm: 127,
      line: { from: { x: -140, y: 0 }, to: { x: -140, y: 300 } },
      witness: [],
      ticks: [
        { x: -140, y: 60 },
        { x: -140, y: 240 },
      ],
      textAt: { x: -170, y: 150 },
    };
    const pts = annotationPoints(chain);
    expect(pts).toContainEqual({ x: -140, y: 60 });
    expect(pts).toContainEqual({ x: -140, y: 240 });
  });
});

describe("technicalDrawingFrame — the mm→svg transform + section fold-in", () => {
  it("Y-flips linearly (drawing Y-up → svg Y-down)", () => {
    const { sy, bounds } = technicalDrawingFrame(DRAWING);
    // sy is affine with slope −1: a step up in drawing-y is a step down in svg-y.
    expect(sy(bounds.max.y) - sy(bounds.min.y)).toBeCloseTo(-(bounds.max.y - bounds.min.y));
    expect(sy(bounds.max.y)).toBeLessThan(sy(bounds.min.y));
  });

  it("emits a viewBox whose min-y is 0 and whose width/height cover the padded bounds", () => {
    const { viewBox, bounds } = technicalDrawingFrame(DRAWING);
    const [minX, minY, w, h] = viewBox.split(" ").map(Number);
    expect(minY).toBe(0);
    const spanX = bounds.max.x - bounds.min.x;
    const spanY = bounds.max.y - bounds.min.y;
    expect(w).toBeGreaterThan(spanX);
    expect(h).toBeGreaterThan(spanY);
    expect(minX).toBeLessThan(bounds.min.x);
  });

  it("folds the section column into the frame bounds (past the elevation)", () => {
    const { bounds } = technicalDrawingFrame(DRAWING);
    const elev = elevationBounds(DRAWING);
    // The section is placed to the right, so the full frame is wider than the
    // elevation alone.
    expect(bounds.max.x).toBeGreaterThan(elev.max.x);
  });
});

describe("placeSections — a cross-section column right of the elevation", () => {
  it("slides the section past the elevation's right edge, height preserved", () => {
    const elev = elevationBounds(DRAWING);
    const [placed] = placeSections(elev, [SECTION]);
    expect(placed).toBeDefined();
    expect(placed!.bbox.min.x).toBeGreaterThan(elev.max.x);
    expect(placed!.dy).toBe(0);
    // dx is the applied translation; the width is preserved.
    expect(placed!.bbox.max.x - placed!.bbox.min.x).toBe(40);
    expect(placed!.bbox.min.y).toBe(SECTION.bbox.min.y);
  });

  it("skips a section with no cuts (nothing to draw, no frame growth)", () => {
    const empty: SectionView = {
      ...SECTION,
      cuts: [],
      bbox: { min: { x: 0, y: 0 }, max: { x: 0, y: 0 } },
    };
    expect(placeSections(elevationBounds(DRAWING), [empty])).toHaveLength(0);
  });
});

describe("dimensionText — label-vs-id fallback + integer mm", () => {
  it("prints the authored label + rounded value", () => {
    expect(dimensionText(DIM)).toBe("Celková šířka 100 mm");
  });

  it("falls back to the rule id when no label is authored", () => {
    const noLabel: PlacedAnnotation = { ...DIM, label: undefined, valueMm: 910 };
    expect(dimensionText(noLabel)).toBe("overall.width 910 mm");
  });

  it("prints only the name when the annotation carries no value", () => {
    const noValue: PlacedAnnotation = { ...DIM, valueMm: undefined };
    expect(dimensionText(noValue)).toBe("Celková šířka");
  });
});
