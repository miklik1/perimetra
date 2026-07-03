import { dehydrate, getQueryClient, HydrationBoundary } from "@repo/api";

import { createCustomersQueries } from "../../lib/customers-queries";
import { createServerApiClient } from "../../lib/server-api";
import { CustomersClient } from "./customers-client";

/**
 * Protected customers page (ADR 0082/CAR-23 surface). The RSC prefetches the
 * first (unfiltered) page as the user (the session cookie is forwarded), so
 * the client renders from hydrated cache. Per-rep scope (admin sees the org,
 * sales sees their own) is applied server-side; a workshop session's prefetch
 * 403s and is swallowed (`prefetchInfiniteQuery` never throws) — the client's
 * role gate shows a notice instead. Access is owned by the proxy gate
 * (`/customers` in PROTECTED_PREFIXES) + `<AuthGuard>` in the client subtree.
 */
export default async function CustomersPage() {
  const customersQueries = createCustomersQueries(await createServerApiClient());
  const qc = getQueryClient();
  await qc.prefetchInfiniteQuery(customersQueries.list());

  return (
    <HydrationBoundary state={dehydrate(qc)}>
      <CustomersClient />
    </HydrationBoundary>
  );
}
