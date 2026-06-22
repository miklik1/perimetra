import { createAuthQueries, dehydrate, getQueryClient, HydrationBoundary } from "@repo/api";

import { createServerApiClient } from "../../../../lib/server-api";
import { DraftsListClient } from "./drafts-list-client";

/**
 * Release-drafts resume list (ADR 0068 Phase 3B). Prefetches `me()` so the
 * client leaf renders the platform gate without a refetch flash; the draft list
 * itself loads client-side (PlatformGuard-enforced server-side).
 */
export default async function DraftsPage() {
  const qc = getQueryClient();
  await qc.prefetchQuery(createAuthQueries(await createServerApiClient()).me());

  return (
    <HydrationBoundary state={dehydrate(qc)}>
      <DraftsListClient />
    </HydrationBoundary>
  );
}
