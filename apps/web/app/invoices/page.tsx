import { dehydrate, getQueryClient, HydrationBoundary } from "@repo/api";

import { createInvoicesQueries } from "../../lib/invoices-queries";
import { createServerApiClient } from "../../lib/server-api";
import { InvoicesClient } from "./invoices-client";

/**
 * Protected invoices page (ADR 0112 / ADR 0127 Wave A1) — the surface that makes
 * the already-shipped, byte-reproducible invoice backend REACHABLE. The RSC
 * prefetches the first page of the infinite list as the user (the session cookie
 * is forwarded) and dehydrates it, so the client renders from hydrated cache.
 * Per-rep scope (ADR 0082) is applied server-side — a sales rep sees their own
 * invoices, an admin the whole org — and is never re-derived here.
 *
 * `prefetchInfiniteQuery` never throws: a 401/403/404 lands in the cache and the
 * client surfaces it through the list's own error branch (the /quotes precedent).
 * Access is owned by the proxy gate (`/invoices` in PROTECTED_PREFIXES) +
 * <AuthGuard> in the client subtree.
 */
export default async function InvoicesPage() {
  const invoicesQueries = createInvoicesQueries(await createServerApiClient());
  const qc = getQueryClient();
  await qc.prefetchInfiniteQuery(invoicesQueries.list());

  return (
    <HydrationBoundary state={dehydrate(qc)}>
      <InvoicesClient />
    </HydrationBoundary>
  );
}
