import { createAuthQueries, dehydrate, getQueryClient, HydrationBoundary } from "@repo/api";

import { createServerApiClient } from "../../lib/server-api";
import { AdminClient } from "./admin-client";

/**
 * Admin publish page (ADR 0061). Prefetches `me()` so the client leaf renders
 * the role-correct UI (admin gate) without a refetch flash. The publish POSTs
 * are `@RequireRole('admin')` — the server enforces; the client gate is UX only.
 */
export default async function AdminPage() {
  const authQueries = createAuthQueries(await createServerApiClient());
  const qc = getQueryClient();
  await qc.prefetchQuery(authQueries.me());

  return (
    <HydrationBoundary state={dehydrate(qc)}>
      <AdminClient />
    </HydrationBoundary>
  );
}
