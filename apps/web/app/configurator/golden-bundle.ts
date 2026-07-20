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
import { DEFAULT_ROUNDING_POLICY, type Catalog } from "@repo/model";

import type { SiteDeriveContext } from "../site/derive";
import type { ConfigurableProduct, ConfiguratorPricing } from "./products";

export const goldenPrices: PriceTable = sitePrices;

/**
 * The golden corpus as `ConfiguratorPricing` (ADR 0116). No cost layer and no
 * floor: the delta-0 lineage predates the cost model (ADR 0059), and the golden
 * totals (gate 81 451.504, site 134 723.5) are stated under the DEFAULT rounding
 * policy — so pinning that policy EXPLICITLY here is what keeps those goldens
 * meaningful. A test that wants cost/margin builds its own literal rather than
 * mutating this one.
 */
export const goldenPricing: ConfiguratorPricing = {
  table: sitePrices,
  cost: null,
  marginFloorPct: null,
  rounding: DEFAULT_ROUNDING_POLICY,
};

export const goldenProducts: ConfigurableProduct[] = [
  { release: slidingGateV1, initialInput: siteGateConfig, catalogVersion: 2 },
  { release: fenceRunV1, initialInput: siteFenceConfig, catalogVersion: 2 },
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
  pricing: goldenPricing,
};
