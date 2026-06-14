import { createAuthQueries, dehydrate, getQueryClient, HydrationBoundary } from "@repo/api";

import { createServerApiClient } from "../../lib/server-api";
import { TeamClient } from "./team-client";

/**
 * Protected team page (ADR 0057). Prefetches the authed `me()` query as the
 * user (its `role` drives the admin-only management surface) and dehydrates it
 * so the client leaf renders the role-correct UI without a refetch flash. The
 * member/invitation roster itself loads client-side off Better Auth's org
 * client — that surface is the plugin's, not a `/v1/*` endpoint.
 */
export default async function TeamPage() {
  const authQueries = createAuthQueries(await createServerApiClient());
  const qc = getQueryClient();
  await qc.prefetchQuery(authQueries.me());

  return (
    <HydrationBoundary state={dehydrate(qc)}>
      <TeamClient />
    </HydrationBoundary>
  );
}
