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
 */
export default async function SitePage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
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
    data = await api.apiFetch<ProjectSite>(`/v1/projects/${projectId}/site`, {
      parse: (d) => projectSiteSchema.parse(d),
    });
  } catch (error) {
    if (isNotFound(error)) notFound();
    if (!isUnauthorized(error)) throw error;
    return (
      <SiteClient
        projectId={projectId}
        initialSite={emptySite(projectId)}
        initialInstances={[]}
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
      bundle={bundle}
    />
  );
}
