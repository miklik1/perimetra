/**
 * The configurator's one compute path: input → engine → (form scope, result,
 * 3D scene). Pure and synchronous — the engine has no I/O (I1) — which is
 * exactly what lets it run inside the compute worker
 * (`lib/configurator-engine.worker.ts`, ADR 0116). This module stays
 * Worker-agnostic: it is the function the worker calls and the function the
 * synchronous fallback calls, so both paths are the same code.
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
} from "@repo/engine";
import type { Catalog, Scope, Site } from "@repo/model";
import {
  buildScene,
  buildSitePlan,
  buildWorkshopDrawing,
  type Scene3D,
  type SitePlan,
  type WorkshopDrawing,
} from "@repo/renderers";

import { type ConfigurableProduct, type ConfiguratorPricing } from "./products";

export interface UiDerivation {
  result: DerivationResult;
  /** The engine's evaluation scope (params + option attrs + derived) when the
   *  config derived valid — what `relevance` and effective values read. */
  scope?: Scope;
  /** Present only for a valid result (an invalid site has no geometric truth
   *  to render — I5). */
  scene?: Scene3D;
  /** Front-elevation workshop drawing (technique 10) — the Summary spec sheet +
   *  the WebGL-unavailable fallback. Pure data off the same valid result. */
  drawing?: WorkshopDrawing;
  /** Top-down site plan (Půdorys) — framed by the first release-authored step
   *  (the ADR 0115 positional carry-over of the retired "Lokalita" treatment). */
  plan?: SitePlan;
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
  pricing: ConfiguratorPricing,
  catalogs: ReadonlyMap<string, Catalog>,
): UiDerivation {
  const { release } = product;
  // The commercial options both derives run under (ADR 0116). `costs` is what
  // makes `result.costTotals`/`costMoney` — and therefore any margin — exist at
  // all; `rounding` is what makes this price EQUAL the one `issue` freezes.
  // Spread-on-presence: passing `costs: undefined` explicitly would be the same
  // to the engine, but the conditional keeps the "no cost layer ⇒ no margin"
  // path visible rather than implied.
  const options = {
    ...(pricing.cost !== null && { costs: pricing.cost }),
    rounding: pricing.rounding,
  };
  // Per-release catalog (ADR 0065): resolve THIS product's catalog from the
  // bundle map (keyed by release id). The bundle always includes it; a miss is a
  // bundle-assembly bug, surfaced loudly rather than deriving against the wrong
  // catalog (I5).
  const catalog = catalogs.get(release.id);
  if (catalog === undefined) {
    throw new Error(`No catalog for release "${release.id}" in the bundle`);
  }
  const detailed = deriveInstanceDetailed(release, input, pricing.table, catalog, options);
  if (!detailed.result.isValid) {
    return { result: detailed.result, ...(detailed.scope && { scope: detailed.scope }) };
  }
  const siteResult = deriveSite(
    previewSite,
    [{ instanceId: PREVIEW_INSTANCE, release, input }],
    pricing.table,
    catalogs,
    options,
  );
  return {
    result: detailed.result,
    ...(detailed.scope && { scope: detailed.scope }),
    // The instance result is valid here, so its pure 2D/3D products all build.
    drawing: buildWorkshopDrawing(detailed.result),
    ...(siteResult.isValid && {
      scene: buildScene(previewSite, siteResult),
      plan: buildSitePlan(previewSite, siteResult),
    }),
  };
}
