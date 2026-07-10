import { notFound } from "next/navigation";

import { getQueryClient } from "@repo/api";
import { type QuoteProduction } from "@repo/validators";

import { createQuotesQueries } from "../../../../../lib/quotes-queries";
import { createServerApiClient } from "../../../../../lib/server-api";
import { TravelerDocument } from "./traveler-document";

/**
 * The shop-floor TRAVELER (ADR 0108) — the printable, price-blind document a
 * fabricator prints and builds from. RSC, mirroring the production view
 * (`../page.tsx`) and the nabídka print surface (ADR 0087): it fetches the SAME
 * price-blind `GET /v1/quotes/:id/production` payload off the frozen snapshot
 * (I3, never re-derived), server-side and authed via the production query
 * (createServerApiClient forwards the session cookie). No second data path — the
 * endpoint is already price-blind and already 404s a non-producible quote
 * (draft/declined/expired), so those fail closed here for free. Browser print()
 * to PDF, zero pdf dependency.
 */
export default async function TravelerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const quotesQueries = createQuotesQueries(await createServerApiClient());

  let production: QuoteProduction | undefined;
  try {
    production = await getQueryClient().fetchQuery(quotesQueries.production(id));
  } catch {
    notFound();
  }
  if (!production) notFound();

  return <TravelerDocument production={production} backHref={`/quotes/${id}/production`} />;
}
