import { createAuthQueries, dehydrate, getQueryClient, HydrationBoundary } from "@repo/api";

import { createServerApiClient } from "../../lib/server-api";
import { AdminClient } from "./admin-client";

/**
 * Tenant admin page (ADR 0061, retiered by ADR 0062): the org's price tables.
 * Catalog/release publishing + per-tenant assignment moved to `/platform`
 * (vendor console). Prefetches `me()` so the client leaf renders the role-correct
 * UI (admin gate) without a refetch flash. The price-table POST is
 * `@RequireRole('admin')` — the server enforces; the client gate is UX only.
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
