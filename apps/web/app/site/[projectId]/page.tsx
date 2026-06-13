import { notFound } from "next/navigation";

import { isNotFound, isUnauthorized } from "@repo/api";
import { projectSiteSchema, type ProjectSite } from "@repo/validators";

import { createServerApiClient } from "../../../lib/server-api";
import { emptySite, fromProjectSite } from "../persistence";
import { SiteClient } from "../site-client";

/**
 * Protected, project-scoped site canvas (step 6.3c). The RSC loads the saved
 * site + roster as the user (`createServerApiClient` forwards the httpOnly
 * session) and prop-passes the canvas's editable shape — no client refetch, the
 * canvas is a local-edit island that saves back with an explicit PUT.
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

  let data: ProjectSite;
  try {
    data = await api.apiFetch<ProjectSite>(`/v1/projects/${projectId}/site`, {
      parse: (d) => projectSiteSchema.parse(d),
    });
  } catch (error) {
    if (isNotFound(error)) notFound();
    if (!isUnauthorized(error)) throw error;
    return (
      <SiteClient projectId={projectId} initialSite={emptySite(projectId)} initialInstances={[]} />
    );
  }

  const { site, instances } = fromProjectSite(projectId, data);
  return <SiteClient projectId={projectId} initialSite={site} initialInstances={instances} />;
}
