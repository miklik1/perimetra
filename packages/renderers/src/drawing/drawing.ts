/**
 * Orchestrator — assembles the derived TechnicalDrawing (CORE_SPEC §5): geometry
 * SoT → solids → projected elevation → feature-bound annotations. A `spec` (the
 * release's immutable DrawingSpec) drives feature-bound dimensions; absent, it
 * falls back to overall bbox dimensions so no family is ever blocked. Pure (I1),
 * I4-clean, and refuses an invalid result (I5) like every renderer.
 */
import type { DerivationResult } from "@repo/engine";
import type { DrawingSpec, ViewDef } from "@repo/model";

import { assertRenderable, type Pt } from "../shared.js";
import { annotate, type AnnotationIntent } from "./annotate.js";
import { place, type PlacedAnnotation } from "./dimsolve.js";
import { FRONT_VIEW, renderView, SIDE_VIEW, TOP_VIEW } from "./project.js";
import { buildSolids } from "./solid.js";
import type { DrawnEdge2D, ViewLinework, ViewSpec } from "./types.js";

export interface TechnicalDrawing {
  viewId: string;
  edges: DrawnEdge2D[];
  annotations: PlacedAnnotation[];
  bbox: { min: Pt; max: Pt };
}

const VIEW_SPECS: Record<ViewDef["projection"], ViewSpec> = {
  front: FRONT_VIEW,
  side: SIDE_VIEW,
  top: TOP_VIEW,
};

/** Overall width + height when no DrawingSpec is authored. */
function defaultAnnotations(view: ViewLinework): PlacedAnnotation[] {
  const { min, max } = view.bbox;
  const intents: AnnotationIntent[] = [
    {
      id: "overall.width",
      kind: "dimension",
      direction: "horizontal",
      side: "bottom",
      from: { x: min.x, y: min.y },
      to: { x: max.x, y: min.y },
      valueMm: max.x - min.x,
    },
    {
      id: "overall.height",
      kind: "dimension",
      direction: "vertical",
      side: "right",
      from: { x: max.x, y: min.y },
      to: { x: max.x, y: max.y },
      valueMm: max.y - min.y,
    },
  ];
  return place(intents, view.bbox);
}

export function buildTechnicalDrawing(
  result: DerivationResult,
  spec?: DrawingSpec,
): TechnicalDrawing {
  assertRenderable(result, "a technical drawing");
  const solids = buildSolids(result);
  const view = renderView(
    solids,
    spec?.views[0] ? VIEW_SPECS[spec.views[0].projection] : FRONT_VIEW,
  );
  const annotations = spec
    ? place(annotate(view, spec, result.derived), view.bbox)
    : defaultAnnotations(view);
  return { viewId: view.viewId, edges: view.edges, annotations, bbox: view.bbox };
}
