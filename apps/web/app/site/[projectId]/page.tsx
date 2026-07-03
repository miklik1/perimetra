import { notFound } from "next/navigation";

import { isNotFound, isUnauthorized } from "@repo/api";
import { projectSiteSchema, type ProjectSite } from "@repo/validators";

import { createServerApiClient } from "../../../lib/server-api";
import { fetchCatalogBundle } from "../../configurator/catalog-bundle";
import { buildProductIndex, type CatalogBundle } from "../../configurator/products";
import { emptySite, fromProjectSite } from "../persistence";
import { SiteClient } from "../site-client";

/**
 * Protected, project-scoped site canvas (step 6.3c; api-served catalog, ADR
 * 0060). The RSC loads the saved site + roster AND the catalog bundle as the user
 * (`createServerApiClient` forwards the httpOnly session), resolves each persisted
 * releaseId to a product index against the api-served roster, and prop-passes the
 * canvas's editable shape + the bundle — no client refetch.
 *
 * - 404 (missing or not-owned project) → notFound(), no existence oracle.
 * - 401 (stale/revoked session) → render an empty shell; the client AuthGuard
 *   resolves the session on mount and redirects to /login (best-effort, the
 *   same resilience the projects page's prefetch has).
 *
 * Access is owned by the proxy gate (`/site` in PROTECTED_PREFIXES) + AuthGuard.
 *
 * `?focus=<instanceId>` lands the canvas with that instance selected — the
 * configurator → project hand-off (CAR-13) appends an instance server-side
 * then navigates here with its id, so the user opens straight onto what they
 * just configured instead of an unselected canvas.
 */
export default async function SitePage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ focus?: string }>;
}) {
  const { projectId } = await params;
  const { focus } = await searchParams;
  const api = await createServerApiClient();

  let bundle: CatalogBundle | null = null;
  try {
    bundle = await fetchCatalogBundle(api);
  } catch (error) {
    if (!isUnauthorized(error)) throw error;
  }
  const productIndex = buildProductIndex(bundle?.products ?? []);

  let data: ProjectSite;
  try {
    // The GET returns the full doc (never 204) — narrow the honest
    // `ProjectSite | undefined` from raw apiFetch.
    data = await (api.apiFetch<ProjectSite>(`/v1/projects/${projectId}/site`, {
      parse: (d) => projectSiteSchema.parse(d),
    }) as Promise<ProjectSite>);
  } catch (error) {
    if (isNotFound(error)) notFound();
    if (!isUnauthorized(error)) throw error;
    return (
      <SiteClient
        projectId={projectId}
        initialSite={emptySite(projectId)}
        initialInstances={[]}
        initialVersion={1}
        initialSelectedId={focus}
        bundle={bundle}
      />
    );
  }

  const { site, instances } = fromProjectSite(projectId, data, productIndex);
  return (
    <SiteClient
      projectId={projectId}
      initialSite={site}
      initialInstances={instances}
      initialVersion={data.version}
      initialSelectedId={focus}
      bundle={bundle}
    />
  );
}
