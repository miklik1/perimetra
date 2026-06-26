import { dehydrate, getQueryClient, HydrationBoundary } from "@repo/api";

import { createQuotesQueries } from "../../lib/quotes-queries";
import { createServerApiClient } from "../../lib/server-api";
import { QuotesClient } from "./quotes-client";

/**
 * Protected quotes page (ADR 0083 surface). The RSC prefetches the first page of
 * the infinite list as the user (the session cookie is forwarded) and dehydrates
 * it, so the client renders from hydrated cache. Per-rep scope (ADR 0082) is
 * applied server-side. Access is owned by the proxy gate (`/quotes` in
 * PROTECTED_PREFIXES) + <AuthGuard> in the client subtree.
 */
export default async function QuotesPage() {
  const quotesQueries = createQuotesQueries(await createServerApiClient());
  const qc = getQueryClient();
  await qc.prefetchInfiniteQuery(quotesQueries.list());

  return (
    <HydrationBoundary state={dehydrate(qc)}>
      <QuotesClient />
    </HydrationBoundary>
  );
}
