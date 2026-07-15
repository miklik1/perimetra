import { dehydrate, getQueryClient, HydrationBoundary } from "@repo/api";

import { createOrdersQueries } from "../../lib/orders-queries";
import { createServerApiClient } from "../../lib/server-api";
import { OrdersClient } from "./orders-client";

/**
 * Protected orders page (ADR 0109 / ADR-O1, CAR-156). The RSC prefetches the
 * first page of the infinite list as the user (session cookie forwarded) and
 * dehydrates it, so the client renders from hydrated cache — the same
 * prefetch+hydrate shape as /quotes. Org scope (ADR 0055) is applied
 * server-side; access is owned by the proxy gate (`/orders` in
 * PROTECTED_PREFIXES) + <AuthGuard> in the client subtree.
 */
export default async function OrdersPage() {
  const ordersQueries = createOrdersQueries(await createServerApiClient());
  const qc = getQueryClient();
  await qc.prefetchInfiniteQuery(ordersQueries.list());

  return (
    <HydrationBoundary state={dehydrate(qc)}>
      <OrdersClient />
    </HydrationBoundary>
  );
}
