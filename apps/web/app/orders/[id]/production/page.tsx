import { dehydrate, getQueryClient, HydrationBoundary } from "@repo/api";

import { createOrdersQueries } from "../../../../lib/orders-queries";
import { createServerApiClient } from "../../../../lib/server-api";
import { OrderProductionClient } from "./production-client";

/**
 * The re-homed workshop PRODUCTION view (ADR 0109 / ADR-O1, CAR-156) — cut
 * list, BOM quantities, 2D drawings, off the order's frozen quote snapshot (I3:
 * never re-derived). Mirrors the quotes production page exactly (RSC prefetch +
 * HydrationBoundary), one pattern across `/quotes/:id/production` (kept N-1) and
 * `/orders/:id/production`. Reachable by admin/sales/workshop alike (the api
 * response is role-independent + price-blind); the proxy gate covers it (the
 * `/orders` protected prefix is a `startsWith`).
 */
export default async function OrderProductionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ordersQueries = createOrdersQueries(await createServerApiClient());
  const qc = getQueryClient();
  // Prefetch both the production projection (the page body) and the thin order
  // reference (the breadcrumb's order-number leaf) so the chrome hydrates
  // SSR-complete — no client-side breadcrumb flash.
  await Promise.all([
    qc.prefetchQuery(ordersQueries.production(id)),
    qc.prefetchQuery(ordersQueries.order(id)),
  ]);

  return (
    <HydrationBoundary state={dehydrate(qc)}>
      <OrderProductionClient id={id} />
    </HydrationBoundary>
  );
}
