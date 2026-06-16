/**
 * The configurator's one compute path: input → engine → (form scope, result,
 * 3D scene). Pure and synchronous — the engine has no I/O (I1), so it runs
 * in the browser per keystroke; persistence/quote stamping arrives with the
 * quote-lifecycle slice of step 6.
 *
 * The 3D scene comes off the SITE derivation of a degenerate one-instance
 * site (I11: a single gate IS a site) so the viewport consumes the exact
 * (Site, SiteResult) contract every renderer holds to (I4) — when the site
 * canvas lands, the same components render multi-instance scenes unchanged.
 */
import {
  deriveInstanceDetailed,
  deriveSite,
  type ConfigInput,
  type DerivationResult,
  type PriceTable,
} from "@repo/engine";
import type { Catalog, Scope, Site } from "@repo/model";
import { buildScene, type Scene3D } from "@repo/renderers";

import { type ConfigurableProduct } from "./products";

export interface UiDerivation {
  result: DerivationResult;
  /** The engine's evaluation scope (params + option attrs + derived) when the
   *  config derived valid — what `relevance` and effective values read. */
  scope?: Scope;
  /** Present only for a valid result (an invalid site has no geometric truth
   *  to render — I5). */
  scene?: Scene3D;
}

const PREVIEW_INSTANCE = "preview";

/** No terrain segment: elevation stays an ordinary form-editable parameter
 *  instead of being driven by a placement (the input gate's one write path). */
const previewSite: Site = {
  id: "configurator-preview",
  terrain: [],
  placements: [{ instanceId: PREVIEW_INSTANCE, pose: { origin_mm: { x: 0, y: 0 } } }],
  connections: [],
};

export function deriveForUi(
  product: ConfigurableProduct,
  input: ConfigInput,
  prices: PriceTable,
  catalog: Catalog,
): UiDerivation {
  const { release } = product;
  const detailed = deriveInstanceDetailed(release, input, prices, catalog);
  if (!detailed.result.isValid) {
    return { result: detailed.result, ...(detailed.scope && { scope: detailed.scope }) };
  }
  const siteResult = deriveSite(
    previewSite,
    [{ instanceId: PREVIEW_INSTANCE, release, input }],
    prices,
    catalog,
  );
  return {
    result: detailed.result,
    ...(detailed.scope && { scope: detailed.scope }),
    ...(siteResult.isValid && { scene: buildScene(previewSite, siteResult) }),
  };
}
