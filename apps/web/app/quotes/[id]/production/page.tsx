import { dehydrate, getQueryClient, HydrationBoundary } from "@repo/api";

import { createQuotesQueries } from "../../../../lib/quotes-queries";
import { createServerApiClient } from "../../../../lib/server-api";
import { ProductionClient } from "./production-client";

/**
 * The workshop PRODUCTION view (CAR-24, ADR 0101) — cut list, BOM quantities,
 * 2D drawings, off the quote's frozen snapshot (I3: never re-derived). Mirrors
 * `../page.tsx` (the priced quote detail) exactly: an RSC prefetch (per-rep
 * scope server-side, cookie forwarded) + `HydrationBoundary`, so the shape is
 * one pattern across `/quotes/:id` and `/quotes/:id/production`. Reachable by
 * admin/sales/workshop alike (the api response is role-independent); the proxy
 * gate covers it for free (the `/quotes` protected prefix is a `startsWith`).
 */
export default async function QuoteProductionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const quotesQueries = createQuotesQueries(await createServerApiClient());
  const qc = getQueryClient();
  await qc.prefetchQuery(quotesQueries.production(id));

  return (
    <HydrationBoundary state={dehydrate(qc)}>
      <ProductionClient id={id} />
    </HydrationBoundary>
  );
}
