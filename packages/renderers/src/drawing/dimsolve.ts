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
  /** dimension/chain: the rule's human-readable display name (its `label`). */
  label?: string;
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

/** Lane geometry is expressed in mm, but a consumer sizes its type as a fraction
 *  of the drawing's largest span (an SVG viewBox scales to its container, so a
 *  fixed mm font would vanish on a large part). On a wide part — an 8 m fence run
 *  — a 100 mm lane step is ~1% of the span while the dimension text is ~2% of it,
 *  so absolute lanes stack the captions on top of each other and the sheet becomes
 *  unreadable. Scale the lanes by the same span, and keep the absolute values as
 *  the floor so a small part (a 1.5 m branka) places exactly as before. */
const BASE_GAP_RATIO = 0.06;
const LANE_STEP_RATIO = 0.05;
const TEXT_GAP_RATIO = 0.018;

/** Labels carry no lane, so two members whose centroids nearly coincide (a bottom
 *  rail and the fill below it) would print one callout on top of the other. Nudge
 *  a colliding label along +y by this fraction of the span — deterministic in id
 *  order, so the drawing stays byte-reproducible (I3).
 *
 *  The ratio must exceed the callout's rendered DIAMETER or the nudge separates
 *  the anchors while the circles still overlap. A consumer draws the callout at
 *  `unit / 34 * 0.85` radius off its padded viewBox (~1.16x this span), i.e. a
 *  diameter near 0.058 of the span; 0.075 clears it with margin. A consumer that
 *  draws a materially larger callout must raise this. */
const LABEL_CLEAR_RATIO = 0.075;

const spanOf = (i: AnnotationIntent): number =>
  i.direction === "horizontal" ? Math.abs(i.to.x - i.from.x) : Math.abs(i.to.y - i.from.y);

export function place(
  intents: readonly AnnotationIntent[],
  bbox: { min: Pt; max: Pt },
): PlacedAnnotation[] {
  const placed: PlacedAnnotation[] = [];

  const unit = Math.max(bbox.max.x - bbox.min.x, bbox.max.y - bbox.min.y);
  const baseGap = Math.max(BASE_GAP, unit * BASE_GAP_RATIO);
  const laneStep = Math.max(LANE_STEP, unit * LANE_STEP_RATIO);
  const textGap = Math.max(TEXT_GAP, unit * TEXT_GAP_RATIO);
  const labelClear = unit * LABEL_CLEAR_RATIO;

  // Labels sit at their anchor centroid (no lane), nudged clear of an earlier
  // label they would otherwise overprint. Sorted by id so the nudge is stable.
  const labelAnchors: Pt[] = [];
  for (const i of [...intents.filter((x) => x.kind === "label")].sort((a, b) =>
    a.id.localeCompare(b.id),
  )) {
    const at = { ...i.from };
    while (
      labelAnchors.some(
        (p) => Math.abs(p.x - at.x) < labelClear && Math.abs(p.y - at.y) < labelClear,
      )
    ) {
      at.y += labelClear;
    }
    labelAnchors.push(at);
    placed.push({
      id: i.id,
      kind: "label",
      ...(i.text !== undefined && { text: i.text }),
      line: { from: i.from, to: i.to },
      witness: [],
      textAt: at,
    });
  }

  const sides: DimensionSide[] = ["bottom", "top", "left", "right"];
  for (const side of sides) {
    // Largest span outermost; id tie-break for determinism.
    const group = intents
      .filter((x) => x.kind !== "label" && x.side === side)
      .sort((a, b) => spanOf(b) - spanOf(a) || a.id.localeCompare(b.id));

    group.forEach((i, lane) => {
      const off = baseGap + lane * laneStep;
      if (side === "bottom" || side === "top") {
        const lineY = side === "bottom" ? bbox.min.y - off : bbox.max.y + off;
        const textY = side === "bottom" ? lineY - textGap : lineY + textGap;
        placed.push({
          id: i.id,
          kind: i.kind,
          ...(i.valueMm !== undefined && { valueMm: i.valueMm }),
          ...(i.label !== undefined && { label: i.label }),
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
        const textX = side === "left" ? lineX - textGap : lineX + textGap;
        placed.push({
          id: i.id,
          kind: i.kind,
          ...(i.valueMm !== undefined && { valueMm: i.valueMm }),
          ...(i.label !== undefined && { label: i.label }),
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
