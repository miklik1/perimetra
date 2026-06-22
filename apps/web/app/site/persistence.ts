/**
 * The seam between the persisted project (the api's `ProjectSite` contract) and
 * the canvas's editable state (`Site` + `PlacedInstance[]`, step 6.3c). The
 * canvas addresses instances by product index (into the api-served roster);
 * persistence pins them by the durable release id — these two functions are the
 * only place that translation happens, so the rest of the canvas stays unaware
 * that a save/load round-trips through a release id. The product roster +
 * release-id index are passed in (ADR 0060: served by the api, not a module
 * singleton).
 *
 * The Site graph crosses opaquely (the engine is the validation gate, I5), so a
 * loaded `site` is cast back to `Site` and a half-built/invalid site round-trips
 * untouched — the "two truths" the canvas already relies on.
 */
import type { ConfigInput } from "@repo/engine";
import type { Site } from "@repo/model";
import type { ProjectSite, ProjectSiteDocument } from "@repo/validators";

import type { ConfigurableProduct } from "../configurator/products";
import type { PlacedInstance } from "./derive";

/** A fresh, valid empty site for a project with nothing designed yet. */
export function emptySite(projectId: string): Site {
  return { id: projectId, terrain: [], placements: [], connections: [] };
}

/**
 * Persisted `ProjectSite` → canvas state. A null `site` (never designed) opens
 * an empty plot. A roster entry whose release id is absent from the api-served
 * roster is dropped (it has no product to render — e.g. a release retired or not
 * yet published); its placement is pruned to match so no orphan draws.
 */
export function fromProjectSite(
  projectId: string,
  data: ProjectSite,
  productIndexByRelease: Map<string, number>,
): { site: Site; instances: PlacedInstance[] } {
  const instances: PlacedInstance[] = [];
  for (const entry of data.instances) {
    const productIndex = productIndexByRelease.get(entry.releaseId);
    if (productIndex === undefined) continue;
    instances.push({
      instanceId: entry.instanceId,
      productIndex,
      input: entry.input as ConfigInput,
    });
  }
  const live = new Set(instances.map((i) => i.instanceId));
  const loaded = (data.site as Site | null) ?? emptySite(projectId);
  const site: Site = {
    ...loaded,
    placements: loaded.placements.filter((p) => live.has(p.instanceId)),
    connections: loaded.connections.filter(
      (c) => live.has(c.a.instanceId) && live.has(c.b.instanceId),
    ),
  };
  return { site, instances };
}

/**
 * Canvas state → save document (site + roster), pinned by release id (resolved
 * from each instance's product index against the api-served roster). Matches
 * `quoteInstanceInputSchema`, so a saved project is issue-ready. The optimistic-
 * lock `expectedVersion` is added at the save call site (not here) so this stays
 * the content-only shape the canvas dirty-tracks.
 */
export function toSavePayload(
  site: Site,
  instances: PlacedInstance[],
  products: ConfigurableProduct[],
): ProjectSiteDocument {
  return {
    site,
    instances: instances.map((p) => ({
      instanceId: p.instanceId,
      releaseId: products[p.productIndex]!.release.id,
      input: p.input,
    })),
  };
}
