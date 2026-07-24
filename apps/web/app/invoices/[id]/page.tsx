import { dehydrate, getQueryClient, HydrationBoundary } from "@repo/api";

import { createInvoicesQueries } from "../../../lib/invoices-queries";
import { createServerApiClient } from "../../../lib/server-api";
import { InvoiceDetailClient } from "./invoice-detail-client";

/**
 * Protected invoice detail (ADR 0112 / ADR 0127) — the ROW view of a frozen §29
 * daňový doklad: identity, dates, the payable total, payment row state and the
 * I3 trust action. The RSC prefetches the invoice AS THE USER, so the api's own
 * per-rep narrowing applies server-side (`scopeOpts(role)`, ADR 0082 — another
 * rep's invoice 404s, never 403s). `prefetchQuery` never throws, so a
 * 401/403/404 lands in the cache and the client surfaces it. Access: proxy gate
 * + AuthGuard.
 *
 * The frozen DOCUMENT (lines, VAT recapitulation, the §92e legend) is NOT read
 * here — it is the print sheet's business (`/invoices/:id/faktura`), which is
 * the only surface allowed to render the kernel's own money strings.
 */
export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const invoicesQueries = createInvoicesQueries(await createServerApiClient());
  const qc = getQueryClient();
  await qc.prefetchQuery(invoicesQueries.detail(id));

  return (
    <HydrationBoundary state={dehydrate(qc)}>
      <InvoiceDetailClient id={id} />
    </HydrationBoundary>
  );
}
