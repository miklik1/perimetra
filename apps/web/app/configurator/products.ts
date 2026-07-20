/**
 * The configurator/site catalog SHAPES (ADR 0060). Releases + catalog + the
 * active price table are served by the api (`./catalog-bundle`): an RSC fetches
 * the bundle and prop-passes it to the client surfaces, which only ever see the
 * `ConfigurableProduct` / `CatalogBundle` types below. This retired the ⌛ interim
 * `@repo/fixtures` runtime source — fixtures is now test-only (its proper role).
 *
 * `initialInput` is the vendor's canonical example config, authored at publish
 * and served on the release (the configurator opens on it). `catalog` is the one
 * version every published release pins (catalog@2 in this slice). `prices` is the
 * org's active price table — `null` for a price-blind/workshop session (the API
 * 403s) or an org with no active table; the surfaces render a notice instead of
 * running the engine when it is absent (the engine requires a price table).
 *
 * Pure types + one helper here (no `@repo/api`), so the engine-side `derive`
 * modules and unit tests import shapes without dragging the fetch layer in.
 */
import type { ConfigInput, CostTable, PriceTable } from "@repo/engine";
import type { Catalog, ProductModelRelease, RoundingPolicy } from "@repo/model";

export interface ConfigurableProduct {
  release: ProductModelRelease;
  /** Vendor's canonical example config — the configurator's starting values. */
  initialInput: ConfigInput;
  /**
   * The catalog version this release pins (per-release catalog, ADR 0065). It
   * lives on the release SUMMARY, not on `ProductModelRelease`, and the surface
   * displays it (the canvas context bar shows "katalog v2026.3") before any
   * derive has produced a `stamps.catalogVersion` — so it is carried here rather
   * than read off a result that may not exist yet.
   */
  catalogVersion: number;
}

/**
 * The org's active price table as every client surface must consume it: the
 * engine price layer PLUS the commercial layers that sit beside it on the same
 * immutable row (ADR 0059 cost, ADR 0081 rounding, ADR 0056/0059 margin floor).
 *
 * This is deliberately ONE object rather than a bare `PriceTable`, because the
 * rounding policy is not optional context — it is part of what a price *is*.
 * `deriveInstanceDetailed`/`deriveSite` default a missing policy to
 * `DEFAULT_ROUNDING_POLICY`, so a caller that forgets to thread it gets a
 * plausible price that silently disagrees with the one `POST /v1/quotes/:id/issue`
 * freezes (`quotes.service.ts` derives under `priceTable.roundingPolicy`). That
 * is a wrong number on a rep's screen, not a crash — so the type makes it
 * unforgettable instead of defaultable.
 */
export interface ConfiguratorPricing {
  /** The engine price layer. */
  table: PriceTable;
  /** Cost-of-goods (ADR 0059) — null on a table published before the cost model,
   *  in which case the engine emits no `costTotals` and no margin can be shown. */
  cost: CostTable | null;
  /** The org's margin floor as a PERCENT (0–100), matching the server guard's
   *  units; null when the org sets no floor. */
  marginFloorPct: number | null;
  /** The commercial rounding policy this org's money is emitted under (ADR 0081)
   *  — the same policy `issue` and `verify` re-derive with. */
  rounding: RoundingPolicy;
}

/** Everything the configurator/site need at load, served by the api. */
export interface CatalogBundle {
  /** Published products in api order (ordering is cosmetic — the palette list). */
  products: ConfigurableProduct[];
  /** Each release's catalog, keyed by release id — per-release catalog (ADR 0065):
   *  different products may pin different catalog versions, so the engine routes
   *  each instance to its own (releases sharing a version share the Catalog
   *  reference). Empty only when nothing is published yet. */
  catalogs: ReadonlyMap<string, Catalog>;
  /** The org's active pricing (price layer + cost + floor + rounding policy);
   *  null for a price-blind/workshop session or an org with no active table.
   *  Named `pricing`, not `prices`, so the ADR 0116 widening is a compile error
   *  at every call site rather than a shape that quietly still destructures. */
  pricing: ConfiguratorPricing | null;
}

/**
 * Release id → product index. The canvas addresses placed instances by index;
 * persistence pins them by the durable release id. Rebuilt from the api response
 * so a reorder of the list can never silently mispair a release. A persisted
 * release id absent here is an unknown release (dropped on load).
 */
export function buildProductIndex(products: ConfigurableProduct[]): Map<string, number> {
  return new Map(products.map((p, i) => [p.release.id, i]));
}
