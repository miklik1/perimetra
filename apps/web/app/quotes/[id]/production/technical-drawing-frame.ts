import type { PlacedAnnotation, Pt, SectionView, TechnicalDrawing } from "@repo/renderers";

/**
 * Pure framing geometry for `TechnicalDrawingSvg` (ADR 0102) — no React, no DOM,
 * so the viewBox/transform/section-layout math tests without jsdom. The emitter
 * works in mm with Y up; SVG is Y down, so `sy` flips every point (same discipline
 * as `configurator/drawing-svg.tsx`).
 */

export interface Box {
  min: Pt;
  max: Pt;
}

function union(pts: readonly Pt[]): Box | undefined {
  if (pts.length === 0) return undefined;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } };
}

/** mm→viewBox with the Y-flip + a proportional print margin — copied from
 *  `viewFrame` in `configurator/drawing-svg.tsx` (one framing convention). */
export function viewFrame(bbox: Box): { viewBox: string; sy: (y: number) => number; unit: number } {
  const spanX = bbox.max.x - bbox.min.x;
  const spanY = bbox.max.y - bbox.min.y;
  const pad = Math.max(spanX, spanY) * 0.08 + 50;
  const minX = bbox.min.x - pad;
  const maxY = bbox.max.y + pad;
  const vbW = spanX + pad * 2;
  const vbH = spanY + pad * 2;
  return {
    viewBox: `${minX} 0 ${vbW} ${vbH}`,
    sy: (y: number) => maxY - y,
    unit: Math.max(vbW, vbH),
  };
}

/** Every point one annotation contributes to the frame — the dimension line,
 *  its witness (extension) lines, chain ticks and the text anchor. Dimension
 *  lines sit OUTSIDE the part, so framing on `drawing.bbox` alone clips them. */
export function annotationPoints(a: PlacedAnnotation): Pt[] {
  const pts: Pt[] = [a.line.from, a.line.to, a.textAt];
  for (const w of a.witness) pts.push(w.from, w.to);
  if (a.ticks) pts.push(...a.ticks);
  return pts;
}

/** The elevation extent: edges + all annotation geometry (mm, Y-up). Sections are
 *  laid out relative to this, then folded into the full frame. */
export function elevationBounds(drawing: TechnicalDrawing): Box {
  const pts: Pt[] = [];
  for (const e of drawing.edges) pts.push(e.from, e.to);
  for (const a of drawing.annotations) pts.push(...annotationPoints(a));
  return union(pts) ?? { min: { x: 0, y: 0 }, max: { x: 0, y: 0 } };
}

/** A cross-section slid into drawing space beside the elevation. `dy` keeps the
 *  section's own height axis (an x/z cut's screen-y IS world height, so it lines
 *  up with the elevation); `dx` pushes it into a column to the right. */
export interface PlacedSection {
  section: SectionView;
  dx: number;
  dy: number;
  /** The section outlines' translated (drawing-space) bounds. */
  bbox: Box;
  /** Where the section id caption sits (above the cross-section). */
  labelAt: Pt;
}

/** Lay each authored section out as its own column to the right of the elevation,
 *  in true relative scale (a nominal-depth cut stays honestly thin — never
 *  widened to look like a measured profile). */
export function placeSections(elev: Box, sections: readonly SectionView[]): PlacedSection[] {
  const drawable = sections.filter((s) => s.cuts.length > 0);
  if (drawable.length === 0) return [];
  const spanX = elev.max.x - elev.min.x;
  const spanY = elev.max.y - elev.min.y;
  const gutter = Math.max(spanX, spanY) * 0.12 + 120;
  const gap = Math.max(spanX, spanY) * 0.06 + 80;
  let cursor = elev.max.x + gutter;
  const placed: PlacedSection[] = [];
  for (const section of drawable) {
    const { min, max } = section.bbox;
    const width = max.x - min.x;
    const dx = cursor - min.x;
    const bbox: Box = { min: { x: cursor, y: min.y }, max: { x: cursor + width, y: max.y } };
    placed.push({
      section,
      dx,
      dy: 0,
      bbox,
      labelAt: { x: (bbox.min.x + bbox.max.x) / 2, y: bbox.max.y },
    });
    cursor += width + gap;
  }
  return placed;
}

export interface DrawingFrame {
  viewBox: string;
  sy: (y: number) => number;
  unit: number;
  bounds: Box;
  sections: PlacedSection[];
}

/** The whole frame the SVG renders against: a viewBox unioning edges, annotation
 *  geometry AND the placed section column, plus the Y-flip and the section
 *  placements the component draws. */
export function technicalDrawingFrame(drawing: TechnicalDrawing): DrawingFrame {
  const elev = elevationBounds(drawing);
  const sections = placeSections(elev, drawing.sections ?? []);
  const pts: Pt[] = [elev.min, elev.max];
  for (const s of sections) pts.push(s.bbox.min, s.bbox.max, s.labelAt);
  const bounds = union(pts) ?? elev;
  return { ...viewFrame(bounds), bounds, sections };
}

/** A dimension's printed caption: its Czech `label` when authored, else the rule
 *  id, followed by the derived value in integer mm (I10 — the emitter already
 *  froze the exact number). */
export function dimensionText(a: PlacedAnnotation): string {
  const name = a.label ?? a.id;
  return a.valueMm === undefined ? name : `${name} ${Math.round(a.valueMm)} mm`;
}
