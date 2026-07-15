import { notFound } from "next/navigation";

import { getQueryClient } from "@repo/api";
import { type QuoteProduction } from "@repo/validators";

import { createOrdersQueries } from "../../../../../lib/orders-queries";
import { createServerApiClient } from "../../../../../lib/server-api";
// Shared traveler document (ADR 0108) — one surface, two entry points (quotes
// N-1, orders); canonical home is the quotes production folder (see the orders
// production-client note). Already route-agnostic: it takes `backHref` as a prop.
import { TravelerDocument } from "../../../../quotes/[id]/production/traveler/traveler-document";

/**
 * The shop-floor TRAVELER (ADR 0108) at order scope — the printable, price-blind
 * document a fabricator builds from. RSC, mirroring the quotes traveler and the
 * nabídka print surface (ADR 0087): it fetches the SAME price-blind
 * `GET /v1/orders/:id/production` payload off the frozen snapshot (I3, never
 * re-derived), server-side and authed via the production query
 * (createServerApiClient forwards the session cookie). No second data path — the
 * endpoint is already price-blind and already 404s a non-producible order, so
 * those fail closed here for free. Browser print() to PDF, zero pdf dependency.
 */
export default async function OrderTravelerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ordersQueries = createOrdersQueries(await createServerApiClient());

  let production: QuoteProduction | undefined;
  try {
    production = await getQueryClient().fetchQuery(ordersQueries.production(id));
  } catch {
    notFound();
  }
  if (!production) notFound();

  return <TravelerDocument production={production} backHref={`/orders/${id}/production`} />;
}
