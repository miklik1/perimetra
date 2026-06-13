/**
 * The site canvas's demo seed (ADR 0051): the golden three-instance project —
 * gate + two fence runs on stepped terrain, the layout whose aggregate the
 * delta-0 harness locks at 129 891.504 CZK. Since project persistence landed
 * (step 6.3c) the canvas LOADS from the saved project, not from here; this is
 * now the one-click "Load demo" populate — a convenience that drops the golden
 * roster into the current project (still authored from @repo/fixtures, the ⌛
 * interim release source that the admin-publish slice retires).
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

import { productIndexByRelease } from "../configurator/products";
import type { PlacedInstance } from "./derive";

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
