import { dehydrate, getQueryClient, HydrationBoundary } from "@repo/api";

import { createCustomersQueries } from "../../../lib/customers-queries";
import { createServerApiClient } from "../../../lib/server-api";
import { CustomerDetailClient } from "./customer-detail-client";

/**
 * Protected customer detail (ADR 0082/CAR-23). The RSC prefetches the
 * customer as the user (per-rep scope server-side, no oracle 404); a stale/
 * scope-mismatched/workshop 403 lands in the cache and the client surfaces
 * it (`prefetchQuery` never throws). Access: proxy gate + `<AuthGuard>`.
 */
export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const customersQueries = createCustomersQueries(await createServerApiClient());
  const qc = getQueryClient();
  await qc.prefetchQuery(customersQueries.get(id));

  return (
    <HydrationBoundary state={dehydrate(qc)}>
      <CustomerDetailClient id={id} />
    </HydrationBoundary>
  );
}
