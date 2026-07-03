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
import type { ProjectInstanceInput, ProjectSite, ProjectSiteDocument } from "@repo/validators";

import type { ConfigurableProduct } from "../configurator/products";
import type { PlacedInstance } from "./derive";

/** Spacing (mm) between auto-placed instances — the ONE source both the
 *  canvas's own "+ add" affordance (`site-client.tsx`) and the configurator's
 *  hand-off (`appendInstanceToDocument` below) place new instances by, so a
 *  hand-off lands indistinguishably from one added by hand. */
export const PLACE_SPACING_MM = 6000;

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

/**
 * Configurator → project hand-off (CAR-13): append ONE new instance — a raw
 * (releaseId, input) pair, release-agnostic — to a project's site document.
 * `existing` is whatever the caller GETs from `GET /v1/projects/:id/site`
 * (a fresh project's `{site: null, instances: []}` included); this stays pure
 * (no fetch) so the caller supplies the current document and later PUTs the
 * result with that same GET's `version` as `expectedVersion` (ADR 0054).
 *
 * Composes the SAME id/placement rules the canvas's own "+ add" affordance
 * uses (`newId`/`addInstance` in `site-client.tsx`): the new instance id is
 * `${modelId}-${n}`, deduped against every id already in use (both the
 * roster's instance ids AND the site's placement ids, in case they ever
 * diverge), and its placement lands `PLACE_SPACING_MM` past the rightmost
 * existing placement — so a hand-off instance is indistinguishable from one
 * placed by hand.
 */
export function appendInstanceToDocument(
  existing: { site: unknown; instances: ProjectInstanceInput[] },
  projectId: string,
  releaseId: string,
  input: ConfigInput,
): { document: { site: Site; instances: ProjectInstanceInput[] }; instanceId: string } {
  const site = (existing.site as Site | null) ?? emptySite(projectId);
  const modelId = releaseId.split("@")[0]!;

  const used = new Set([
    ...existing.instances.map((i) => i.instanceId),
    ...site.placements.map((p) => p.instanceId),
  ]);
  let n = 1;
  while (used.has(`${modelId}-${n}`)) n += 1;
  const instanceId = `${modelId}-${n}`;

  const nextX =
    site.placements.reduce((m, p) => Math.max(m, p.pose.origin_mm.x), -PLACE_SPACING_MM) +
    PLACE_SPACING_MM;

  return {
    document: {
      site: {
        ...site,
        placements: [...site.placements, { instanceId, pose: { origin_mm: { x: nextX, y: 0 } } }],
      },
      instances: [...existing.instances, { instanceId, releaseId, input }],
    },
    instanceId,
  };
}
