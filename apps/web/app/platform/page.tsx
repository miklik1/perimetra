import { createAuthQueries, dehydrate, getQueryClient, HydrationBoundary } from "@repo/api";

import { createServerApiClient } from "../../lib/server-api";
import { PlatformClient } from "./platform-client";

/**
 * Platform/vendor console (ADR 0062). Prefetches `me()` so the client leaf
 * renders the platform gate (`isPlatformAdmin`) without a refetch flash. Every
 * mutation here is `PlatformGuard`-enforced server-side; the client gate is UX only.
 */
export default async function PlatformPage() {
  const authQueries = createAuthQueries(await createServerApiClient());
  const qc = getQueryClient();
  await qc.prefetchQuery(authQueries.me());

  return (
    <HydrationBoundary state={dehydrate(qc)}>
      <PlatformClient />
    </HydrationBoundary>
  );
}
