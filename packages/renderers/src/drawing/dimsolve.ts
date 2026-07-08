/**
 * DimensionSolver — turns logical AnnotationIntents into collision-free placed
 * geometry (CORE_SPEC §5). Fully automatic (zero hand-layout — the point of the
 * spike): group by side, lane-stack parallel dimensions (largest span outermost,
 * so overall dims sit outside member dims), build witness/extension lines, place
 * text. Pure + deterministic — ordering is keyed by intent id (I9), so the output
 * is byte-identical across re-derivation, which is what makes the vector golden
 * possible. Separate from the Annotator: layout-packing vs rule-selection.
 */
import type { DimensionSide } from "@repo/model";

import type { Pt } from "../shared.js";
import type { AnnotationIntent } from "./annotate.js";

export interface PlacedAnnotation {
  id: string;
  kind: "dimension" | "chain" | "label";
  valueMm?: number;
  text?: string;
  /** The dimension line (degenerate for a label). */
  line: { from: Pt; to: Pt };
  /** Extension lines from the feature to the dimension line. */
  witness: { from: Pt; to: Pt }[];
  /** Chain tick points on the dimension line. */
  ticks?: Pt[];
  textAt: Pt;
}

const BASE_GAP = 140;
const LANE_STEP = 100;
const TEXT_GAP = 30;

const spanOf = (i: AnnotationIntent): number =>
  i.direction === "horizontal" ? Math.abs(i.to.x - i.from.x) : Math.abs(i.to.y - i.from.y);

export function place(
  intents: readonly AnnotationIntent[],
  bbox: { min: Pt; max: Pt },
): PlacedAnnotation[] {
  const placed: PlacedAnnotation[] = [];

  // Labels sit at their anchor centroid (no lane).
  for (const i of intents.filter((x) => x.kind === "label")) {
    placed.push({
      id: i.id,
      kind: "label",
      ...(i.text !== undefined && { text: i.text }),
      line: { from: i.from, to: i.to },
      witness: [],
      textAt: i.from,
    });
  }

  const sides: DimensionSide[] = ["bottom", "top", "left", "right"];
  for (const side of sides) {
    // Largest span outermost; id tie-break for determinism.
    const group = intents
      .filter((x) => x.kind !== "label" && x.side === side)
      .sort((a, b) => spanOf(b) - spanOf(a) || a.id.localeCompare(b.id));

    group.forEach((i, lane) => {
      const off = BASE_GAP + lane * LANE_STEP;
      if (side === "bottom" || side === "top") {
        const lineY = side === "bottom" ? bbox.min.y - off : bbox.max.y + off;
        const textY = side === "bottom" ? lineY - TEXT_GAP : lineY + TEXT_GAP;
        placed.push({
          id: i.id,
          kind: i.kind,
          ...(i.valueMm !== undefined && { valueMm: i.valueMm }),
          line: { from: { x: i.from.x, y: lineY }, to: { x: i.to.x, y: lineY } },
          witness: [
            { from: i.from, to: { x: i.from.x, y: lineY } },
            { from: i.to, to: { x: i.to.x, y: lineY } },
          ],
          ...(i.ticks !== undefined && { ticks: i.ticks.map((t) => ({ x: t, y: lineY })) }),
          textAt: { x: (i.from.x + i.to.x) / 2, y: textY },
        });
      } else {
        const lineX = side === "left" ? bbox.min.x - off : bbox.max.x + off;
        const textX = side === "left" ? lineX - TEXT_GAP : lineX + TEXT_GAP;
        placed.push({
          id: i.id,
          kind: i.kind,
          ...(i.valueMm !== undefined && { valueMm: i.valueMm }),
          line: { from: { x: lineX, y: i.from.y }, to: { x: lineX, y: i.to.y } },
          witness: [
            { from: i.from, to: { x: lineX, y: i.from.y } },
            { from: i.to, to: { x: lineX, y: i.to.y } },
          ],
          ...(i.ticks !== undefined && { ticks: i.ticks.map((t) => ({ x: lineX, y: t })) }),
          textAt: { x: textX, y: (i.from.y + i.to.y) / 2 },
        });
      }
    });
  }

  return placed.sort((a, b) => a.id.localeCompare(b.id));
}
