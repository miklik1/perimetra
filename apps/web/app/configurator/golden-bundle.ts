/**
 * Test-only golden catalog bundle (NOT imported by runtime code — the app fetches
 * the equivalent from the api, ADR 0060). The @repo/fixtures corpus shaped as the
 * api-served catalog so the configurator/site compute + render tests keep the
 * delta-0 golden lineage (gate 81 451.504, site 134 723.5) without standing up
 * the api. Fixtures' proper role: the golden source for tests, never runtime.
 */
import type { PriceTable } from "@repo/engine";
import {
  catalogV2,
  fenceRunV1,
  siteFenceConfig,
  siteGateConfig,
  sitePrices,
  slidingGateV1,
} from "@repo/fixtures";
import type { Catalog } from "@repo/model";

import type { SiteDeriveContext } from "../site/derive";
import type { ConfigurableProduct } from "./products";

export const goldenPrices: PriceTable = sitePrices;

export const goldenProducts: ConfigurableProduct[] = [
  { release: slidingGateV1, initialInput: siteGateConfig },
  { release: fenceRunV1, initialInput: siteFenceConfig },
];

/** Per-release catalog map (ADR 0065), keyed by release id — both golden
 *  products on catalog@2 (the delta-0 lineage). */
export const goldenCatalogs: ReadonlyMap<string, Catalog> = new Map([
  [slidingGateV1.id, catalogV2],
  [fenceRunV1.id, catalogV2],
]);

export const goldenCtx: SiteDeriveContext = {
  products: goldenProducts,
  catalogs: goldenCatalogs,
  prices: goldenPrices,
};
