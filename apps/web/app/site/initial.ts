/**
 * The site canvas's "Load demo" seed (ADR 0051, ADR 0060): the golden three-
 * instance project — gate + two fence runs on stepped terrain, the layout whose
 * aggregate the delta-0 harness locks at 134 723.5 CZK. Since project
 * persistence landed (step 6.3c) the canvas LOADS from the saved project; this is
 * the one-click populate.
 *
 * Release-agnostic geometry (poses/terrain/connections) is inlined here — it
 * carries NO vendor data. Each instance's config comes from the api-served
 * product's `initialInput` (the vendor's canonical example), so the demo no
 * longer imports @repo/fixtures.
 */
import type { Site } from "@repo/model";

import type { ConfigurableProduct } from "../configurator/products";
import { buildProductIndex } from "../configurator/products";
import type { PlacedInstance } from "./derive";

/** GATE — fenceA — fenceB, fenceB one terrain step (+150) up (golden/site.ts). */
const STEPPED_SITE: Site = {
  id: "demo-site",
  terrain: [
    { id: "s1", elevation_mm: 0 },
    { id: "s2", elevation_mm: 150 },
  ],
  placements: [
    { instanceId: "gate", pose: { origin_mm: { x: 0, y: 0 } }, terrainSegmentId: "s1" },
    { instanceId: "fenceA", pose: { origin_mm: { x: 4200, y: 0 } }, terrainSegmentId: "s1" },
    { instanceId: "fenceB", pose: { origin_mm: { x: 9200, y: 0 } }, terrainSegmentId: "s2" },
  ],
  connections: [
    { a: { instanceId: "gate", portId: "right" }, b: { instanceId: "fenceA", portId: "start" } },
    { a: { instanceId: "fenceA", portId: "end" }, b: { instanceId: "fenceB", portId: "start" } },
  ],
};

/** Which release each placed instance carries (the Site stores only poses/
 *  connections/terrain, never releases). Resolved to a product index by release
 *  id against the api-served roster; the config is the product's `initialInput`. */
const DEMO_ROSTER: { instanceId: string; releaseId: string }[] = [
  { instanceId: "gate", releaseId: "sliding-gate@1" },
  { instanceId: "fenceA", releaseId: "fence-run@1" },
  { instanceId: "fenceB", releaseId: "fence-run@1" },
];

/** The releases the demo needs — the canvas hides "Load demo" unless every one
 *  is in the api-served roster (so the button never triggers the throw below). */
export const DEMO_RELEASE_IDS = [...new Set(DEMO_ROSTER.map((r) => r.releaseId))];

export function demoSite(): Site {
  // Clone — the canvas mutates placements/connections/terrain.
  return structuredClone(STEPPED_SITE);
}

export function demoInstances(products: ConfigurableProduct[]): PlacedInstance[] {
  const index = buildProductIndex(products);
  return DEMO_ROSTER.map(({ instanceId, releaseId }) => {
    const productIndex = index.get(releaseId);
    if (productIndex === undefined) throw new Error(`demo release not published: ${releaseId}`);
    return {
      instanceId,
      productIndex,
      input: structuredClone(products[productIndex]!.initialInput),
    };
  });
}
