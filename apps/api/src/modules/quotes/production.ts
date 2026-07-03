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
 */
import type { QuoteStatus } from "@repo/db/schema/quotes";
import type { SiteBomLine } from "@repo/engine";
import type { CutList, SitePlan, WorkshopDrawing } from "@repo/renderers";
import type { QuoteProduction } from "@repo/validators/quotes";

/** The frozen-snapshot fields this projection reads — a narrow local view of
 *  `QuoteSnapshot` (quotes.service.ts) so this module stays a standalone leaf
 *  (no import of the service that will import IT). */
export interface ProductionSourceSnapshot {
  bom: SiteBomLine[];
  cutList: CutList;
  cutOptions: { kerfMm: number };
  drawings: { site: SitePlan; instances: Record<string, WorkshopDrawing> };
  inputs: Record<string, { releaseId: string }>;
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
  };
}
