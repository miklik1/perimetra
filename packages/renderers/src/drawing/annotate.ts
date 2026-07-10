/**
 * Annotator — the drawing-rule DSL interpreter (CORE_SPEC §5). Resolves each
 * rule's FeatureSelector to concrete anchors on the PROJECTED linework and takes
 * its printed value from the derived scope, so the number the drawing prints is
 * the number the engine derived (Excel fidelity by construction). Emits logical
 * AnnotationIntents; the DimensionSolver turns them into placed geometry. Kept
 * separate so rule-selection and layout-packing test independently.
 */
import { pieceGlobToRegex, type DimensionSide, type DrawingSpec } from "@repo/model";

import type { Pt } from "../shared.js";
import type { ViewLinework } from "./types.js";

export interface AnnotationIntent {
  id: string;
  kind: "dimension" | "chain" | "label";
  direction: "horizontal" | "vertical";
  side: DimensionSide;
  /** The two witness anchor points (the bracketed span on the feature). */
  from: Pt;
  to: Pt;
  valueMm?: number;
  text?: string;
  /** dimension/chain: the rule's human-readable display name (its `label`). */
  label?: string;
  /** chain: each repeated piece's centre along the measured axis (tick lines). */
  ticks?: number[];
}

const pieceOf = (sourceId: string): string => sourceId.split("#")[0]!;

interface Extent {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

const extentOf = (pts: Pt[]): Extent => ({
  minX: Math.min(...pts.map((p) => p.x)),
  maxX: Math.max(...pts.map((p) => p.x)),
  minY: Math.min(...pts.map((p) => p.y)),
  maxY: Math.max(...pts.map((p) => p.y)),
});

export function annotate(
  view: ViewLinework,
  spec: DrawingSpec,
  derived: Record<string, number>,
): AnnotationIntent[] {
  const intents: AnnotationIntent[] = [];

  for (const rule of spec.rules) {
    const re = pieceGlobToRegex(rule.feature.pieces);
    const matched = view.edges.filter((e) => re.test(pieceOf(e.sourceId)));
    if (matched.length === 0) continue;
    const pts = matched.flatMap((e) => [e.from, e.to]);
    const ext = extentOf(pts);

    if (rule.kind === "label") {
      const cx = (ext.minX + ext.maxX) / 2;
      const cy = (ext.minY + ext.maxY) / 2;
      intents.push({
        id: rule.id,
        kind: "label",
        direction: "horizontal",
        side: "top",
        from: { x: cx, y: cy },
        to: { x: cx, y: cy },
        text: rule.text,
      });
      continue;
    }

    const value = rule.derivedValue !== undefined ? derived[rule.derivedValue] : undefined;

    if (rule.kind === "chain") {
      // Each matched piece's centre along the measured axis (the stacked slats).
      const byPiece = new Map<string, Pt[]>();
      for (const e of matched) {
        const id = pieceOf(e.sourceId);
        (byPiece.get(id) ?? byPiece.set(id, []).get(id)!).push(e.from, e.to);
      }
      const centres = [...byPiece.values()]
        .map((ps) => {
          const pe = extentOf(ps);
          return rule.measure === "y-extent" ? (pe.minY + pe.maxY) / 2 : (pe.minX + pe.maxX) / 2;
        })
        .sort((a, b) => a - b);
      const vertical = rule.measure === "y-extent";
      intents.push({
        id: rule.id,
        kind: "chain",
        direction: vertical ? "vertical" : "horizontal",
        side: rule.side,
        from: vertical ? { x: ext.minX, y: centres[0]! } : { x: centres[0]!, y: ext.minY },
        to: vertical
          ? { x: ext.minX, y: centres[centres.length - 1]! }
          : { x: centres[centres.length - 1]!, y: ext.minY },
        ...(value !== undefined && { valueMm: value }),
        ...(rule.label !== undefined && { label: rule.label }),
        ticks: centres,
      });
      continue;
    }

    // dimension
    const horizontal = rule.measure === "x-extent";
    const span = horizontal ? ext.maxX - ext.minX : ext.maxY - ext.minY;
    intents.push({
      id: rule.id,
      kind: "dimension",
      direction: horizontal ? "horizontal" : "vertical",
      side: rule.side,
      from: horizontal ? { x: ext.minX, y: ext.minY } : { x: ext.minX, y: ext.minY },
      to: horizontal ? { x: ext.maxX, y: ext.minY } : { x: ext.minX, y: ext.maxY },
      valueMm: value ?? span,
      ...(rule.label !== undefined && { label: rule.label }),
    });
  }

  return intents;
}
