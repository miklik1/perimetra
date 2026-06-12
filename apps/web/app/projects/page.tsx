import { dehydrate, getQueryClient, HydrationBoundary } from "@repo/api";

import { createProjectsQueries } from "../../lib/projects-queries";
import { createServerApiClient } from "../../lib/server-api";
import { ProjectsClient } from "./projects-client";

/**
 * Protected projects page (mirrors /account). The RSC prefetches the FIRST
 * page of the infinite list as the user — `createServerApiClient` forwards the
 * httpOnly session cookie — and dehydrates it, so the client list renders from
 * hydrated cache with no refetch (the ADR-0007 pipeline, infinite variant).
 *
 * Best-effort: a stale/revoked session 401s here and the browser client
 * refetches after hydration. Access is owned by the proxy gate (`/projects` in
 * PROTECTED_PREFIXES) + <AuthGuard> in the client subtree.
 */
export default async function ProjectsPage() {
  const projectsQueries = createProjectsQueries(await createServerApiClient());
  const qc = getQueryClient();
  await qc.prefetchInfiniteQuery(projectsQueries.list());

  return (
    <HydrationBoundary state={dehydrate(qc)}>
      <ProjectsClient />
    </HydrationBoundary>
  );
}
