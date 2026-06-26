import { dehydrate, getQueryClient, HydrationBoundary } from "@repo/api";

import { createQuotesQueries } from "../../../lib/quotes-queries";
import { createServerApiClient } from "../../../lib/server-api";
import { QuoteDetailClient } from "./quote-detail-client";

/**
 * Protected quote detail (ADR 0083). The RSC prefetches the quote as the user
 * (per-rep scope server-side); `prefetchQuery` never throws, so a 404/401 lands
 * in the cache and the client surfaces it. Access: proxy gate + AuthGuard.
 */
export default async function QuoteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const quotesQueries = createQuotesQueries(await createServerApiClient());
  const qc = getQueryClient();
  await qc.prefetchQuery(quotesQueries.detail(id));

  return (
    <HydrationBoundary state={dehydrate(qc)}>
      <QuoteDetailClient id={id} />
    </HydrationBoundary>
  );
}
