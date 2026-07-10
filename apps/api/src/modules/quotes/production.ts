/**
 * The workshop PRODUCTION projection (CAR-24) — a ROLE-INDEPENDENT, ALWAYS
 * price-blind view of a frozen quote snapshot: cut list, BOM quantities, 2D
 * drawings. Built off the FROZEN `QuoteSnapshot` (quotes.service.ts) — NEVER
 * re-derived, so a since-changed price table/release cannot alter what the
 * workshop sees (I3).
 *
 * An ALLOWLIST projection, the same discipline as `blindSnapshot` (ADR 0056):
 * only geometry/quantity fields are copied through, so a future snapshot field
 * that happens to carry money can't leak by being forgotten. Unlike
 * `blindSnapshot` this view is NOT role-conditional — production has no price
 * to hide from admin/sales either; it's a distinct SURFACE (what to build), not
 * a distinct permission level.
 *
 * The one narrow leak vector this module closes: a part's cascade override can
 * target a COMMERCIAL `ArtifactField` (`pricePerUnit`/`totalPrice`, @repo/model),
 * not just a physical one (`quantity`/`lengthMm`) — so an overridden part would
 * otherwise carry that raw float into `drawings.instances[id].flags` via
 * `PartDeviation`. `productionSafeDrawing` drops those: only the physically
 * relevant deviations survive, which is also the workshop's actual concern
 * (CORE_SPEC §6 — "the workshop always sees what deviated" means dimensionally,
 * never commercially). Pure + zero I/O, tested standalone (production.test.ts).
 *
 * ADR 0108 adds three per-instance fields projected from the SAME frozen snapshot:
 * the derived 2D `technicalDrawings` (allowlist-copied like the workshop drawing,
 * even though annotations carry no money today — the copy is the guard, not the
 * current field list), the §8 `specRows` spec sheet (frozen release labels), and
 * `dimensionRows` (label + measured value, derived from each drawing's dimension/
 * chain annotations). All THREE degrade cleanly on a pre-slice snapshot that
 * froze none of them (fields absent ⇒ the projection omits them, never throws).
 */
import type { QuoteStatus } from "@repo/db/schema/quotes";
import type { SiteBomLine } from "@repo/engine";
import type { CutList, SitePlan, TechnicalDrawing, WorkshopDrawing } from "@repo/renderers";
import type {
  ProductionDimensionRow,
  ProductionSpecRow,
  ProductionTechnicalDrawing,
  QuoteProduction,
} from "@repo/validators/quotes";

/** The frozen-snapshot fields this projection reads — a narrow local view of
 *  `QuoteSnapshot` (quotes.service.ts) so this module stays a standalone leaf
 *  (no import of the service that will import IT). */
export interface ProductionSourceSnapshot {
  bom: SiteBomLine[];
  cutList: CutList;
  cutOptions: { kerfMm: number };
  drawings: { site: SitePlan; instances: Record<string, WorkshopDrawing> };
  inputs: Record<string, { releaseId: string }>;
  /** Frozen 2D technical drawings per instance (ADR 0108). Absent on a snapshot
   *  issued before the frozen-drawing slice — the projection omits it then. */
  technicalDrawings?: Record<string, TechnicalDrawing>;
  /** Frozen §8 spec-sheet rows per instance (ADR 0108). Absent pre-slice. */
  specRows?: Record<string, ProductionSpecRow[]>;
}

/** A `WorkshopDrawing` narrowed to the two PHYSICAL `ArtifactField`s
 *  (@repo/model) — the workshop's concern. `pricePerUnit`/`totalPrice` are
 *  commercial and never cross this boundary; the narrowed `field` union
 *  mirrors `quoteProductionSchema`'s `productionDrawingFlagSchema` exactly. */
export type ProductionDrawing = Omit<WorkshopDrawing, "flags"> & {
  flags: (Omit<WorkshopDrawing["flags"][number], "field"> & {
    field: "quantity" | "lengthMm";
  })[];
};

function isPhysicalFlag(
  flag: WorkshopDrawing["flags"][number],
): flag is ProductionDrawing["flags"][number] {
  return flag.field === "quantity" || flag.field === "lengthMm";
}

/** Strip commercial deviation flags off a workshop drawing (see module doc). */
export function productionSafeDrawing(drawing: WorkshopDrawing): ProductionDrawing {
  return { ...drawing, flags: drawing.flags.filter(isPhysicalFlag) };
}

/** An explicit allowlist copy of a `TechnicalDrawing` (ADR 0108) — the same
 *  discipline as `productionSafeDrawing`. The drawing carries geometry +
 *  dimensions + labels, no money today; the field-by-field copy is the guard so
 *  a future money-bearing field can't ride through by being forgotten. The
 *  `ProductionTechnicalDrawing` return binds it to the price-blind wire schema. */
export function productionSafeTechnicalDrawing(
  drawing: TechnicalDrawing,
): ProductionTechnicalDrawing {
  return {
    viewId: drawing.viewId,
    edges: drawing.edges,
    annotations: drawing.annotations,
    bbox: drawing.bbox,
    ...(drawing.sections !== undefined && { sections: drawing.sections }),
  };
}

/** Dimension rows for the traveler (ADR 0108): each dimension/chain annotation's
 *  display label (falling back to the rule id) + its measured value. A "label"
 *  annotation is a member callout, not a dimension, so it never becomes a row;
 *  an annotation with no measured value is skipped. */
function dimensionRowsOf(drawing: TechnicalDrawing): ProductionDimensionRow[] {
  return drawing.annotations.flatMap((a) =>
    a.kind === "label" || a.valueMm === undefined
      ? []
      : [{ id: a.id, label: a.label ?? a.id, valueMm: a.valueMm }],
  );
}

/** Only an effectively `issued`/`accepted` quote has a production run — a
 *  declined/expired offer, or an (unreachable today) draft, has nothing to
 *  build. Fail-closed the same way the buyer nabídka route's snapshot guard is. */
export function isProducible(status: QuoteStatus): status is "issued" | "accepted" {
  return status === "issued" || status === "accepted";
}

/** Build the workshop-safe `QuoteProduction` off a frozen snapshot. The caller
 *  (quotes.service.ts) is responsible for the `isProducible` gate — this is a
 *  pure shape transform, no status branching. */
export function toProduction(
  row: { id: string; documentNumber: string; createdAt: Date },
  effective: "issued" | "accepted",
  snapshot: ProductionSourceSnapshot,
): QuoteProduction {
  return {
    id: row.id,
    documentNumber: row.documentNumber,
    status: effective,
    createdAt: row.createdAt.toISOString(),
    instances: Object.entries(snapshot.inputs).map(([instanceId, seed]) => ({
      instanceId,
      releaseId: seed.releaseId,
    })),
    bom: snapshot.bom.map((line) => ({
      componentCode: line.componentCode,
      name: line.name,
      unit: line.unit,
      category: line.category,
      quantity: line.quantity,
      sources: line.sources,
    })),
    cutList: snapshot.cutList,
    cutOptions: snapshot.cutOptions,
    drawings: {
      site: snapshot.drawings.site,
      instances: Object.fromEntries(
        Object.entries(snapshot.drawings.instances).map(([id, d]) => [
          id,
          productionSafeDrawing(d),
        ]),
      ),
    },
    // ADR 0108 — degrade cleanly on a pre-slice snapshot: absent frozen fields
    // are omitted (never fabricated). technicalDrawings + its derived
    // dimensionRows co-vary (rows come off the drawings); specRows is independent.
    ...(snapshot.technicalDrawings !== undefined && {
      technicalDrawings: Object.fromEntries(
        Object.entries(snapshot.technicalDrawings).map(([id, d]) => [
          id,
          productionSafeTechnicalDrawing(d),
        ]),
      ),
      dimensionRows: Object.fromEntries(
        Object.entries(snapshot.technicalDrawings).map(([id, d]) => [id, dimensionRowsOf(d)]),
      ),
    }),
    ...(snapshot.specRows !== undefined && { specRows: snapshot.specRows }),
  };
}
