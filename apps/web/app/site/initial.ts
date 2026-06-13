/**
 * The site canvas's interim seed (ADR 0051, ⌛ transitional): the page opens on
 * the golden three-instance project — gate + two fence runs on stepped terrain,
 * the layout whose aggregate the delta-0 harness locks at 129 891.504 CZK — so
 * the canvas opens on a derivation proven byte-identical to the MVP lineage,
 * exactly as the configurator opens on the Excel anchor. Replaced by a fetch
 * (the loaded project) when project persistence lands; components only ever see
 * `Site` + `PlacedInstance`, so the swap is local to this module.
 */
import type { ConfigInput } from "@repo/engine";
import {
  fenceRunV1,
  siteFenceConfig,
  siteGateConfig,
  slidingGateV1,
  steppedSite,
} from "@repo/fixtures";
import type { Site } from "@repo/model";

import { products } from "../configurator/products";
import type { PlacedInstance } from "./derive";

const productIndexByRelease = new Map(products.map((p, i) => [p.release.id, i]));

/** The golden roster: which release + config each placed instance carries (the
 *  Site itself stores only poses/connections/terrain, never releases). Resolved
 *  to a product index by release id, so a reorder of `products` can never
 *  silently mispair a release. */
const SEED_ROSTER: { instanceId: string; releaseId: string; input: ConfigInput }[] = [
  { instanceId: "gate", releaseId: slidingGateV1.id, input: siteGateConfig },
  { instanceId: "fenceA", releaseId: fenceRunV1.id, input: siteFenceConfig },
  { instanceId: "fenceB", releaseId: fenceRunV1.id, input: siteFenceConfig },
];

export function initialSite(): Site {
  // Clone — the canvas mutates placements/connections/terrain; the fixture is a
  // shared module singleton that must stay pristine for other consumers.
  return structuredClone(steppedSite);
}

export function initialInstances(): PlacedInstance[] {
  return SEED_ROSTER.map(({ instanceId, releaseId, input }) => {
    const productIndex = productIndexByRelease.get(releaseId);
    if (productIndex === undefined) throw new Error(`seed release not in products: ${releaseId}`);
    return { instanceId, productIndex, input: structuredClone(input) };
  });
}
