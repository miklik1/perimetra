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
import type { ConfigInput, PriceTable } from "@repo/engine";
import type { Catalog, ProductModelRelease } from "@repo/model";

export interface ConfigurableProduct {
  release: ProductModelRelease;
  /** Vendor's canonical example config — the configurator's starting values. */
  initialInput: ConfigInput;
}

/** Everything the configurator/site need at load, served by the api. */
export interface CatalogBundle {
  /** Published products in api order (ordering is cosmetic — the palette list). */
  products: ConfigurableProduct[];
  /** The catalog every release pins (one shared version this slice). Null only
   *  when nothing is published yet. */
  catalog: Catalog | null;
  /** The org's active price table; null for a price-blind/workshop session or an
   *  org with no active table. */
  prices: PriceTable | null;
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
