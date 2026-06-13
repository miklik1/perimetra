/**
 * The configurator's interim release source (ADR 0051): the vendor-authored
 * releases + catalog + price table come straight from @repo/fixtures until the
 * release-assignment/persistence slice of step 6 lands. ⌛ Transitional — when
 * tenants get release pins served by the api, this file is replaced by a
 * fetch; the components only ever see `ConfigurableProduct`, so the swap is
 * local to this module.
 *
 * Initial inputs are the golden-corpus configs: the page opens on a derivation
 * the delta-0 harness proves byte-identical to the MVP's Excel anchor.
 */
import type { ConfigInput, PriceTable } from "@repo/engine";
import {
  catalogV2,
  fenceRunV1,
  siteFenceConfig,
  siteGateConfig,
  sitePrices,
  slidingGateV1,
} from "@repo/fixtures";
import type { Catalog, ProductModelRelease } from "@repo/model";

export interface ConfigurableProduct {
  release: ProductModelRelease;
  /** Starting values — a config the golden corpus locks. */
  initialInput: ConfigInput;
}

export const catalog: Catalog = catalogV2;
export const prices: PriceTable = sitePrices;

export const products: ConfigurableProduct[] = [
  { release: slidingGateV1, initialInput: siteGateConfig },
  { release: fenceRunV1, initialInput: siteFenceConfig },
];

/**
 * Release id → product index: the canvas addresses placed instances by product
 * index (the interim source's addressing), but persistence pins them by the
 * durable release id. This map is the one bridge between the two — resolved by
 * id so a reorder of `products` can never silently mispair a release. A
 * persisted release id absent here is an unknown release (dropped on load).
 */
export const productIndexByRelease = new Map(products.map((p, i) => [p.release.id, i]));
