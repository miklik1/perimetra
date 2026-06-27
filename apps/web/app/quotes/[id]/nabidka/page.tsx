import { notFound } from "next/navigation";

import { type SiteResult } from "@repo/engine";
import { type Site, type TaxBreakdown } from "@repo/model";
import { buildNabidka, type NabidkaCustomer } from "@repo/renderers";
import { quoteSchema, type QuoteDetail } from "@repo/validators";

import { createServerApiClient } from "../../../../lib/server-api";
import { NabidkaDocumentView } from "./nabidka-document";

/** The frozen snapshot fields the nabídka reads (the engine's own valid output,
 *  opaque to the wire). `customer` is the ADR-0086 freeze; `tax`/`bom`/`money`
 *  are absent from the price-blind workshop projection → that role 404s here. */
interface NabidkaSnapshot {
  site: Site;
  bom: SiteResult["bom"];
  money: SiteResult["money"];
  tax: TaxBreakdown;
  customer?: {
    name: string;
    ico: string | null;
    dic: string | null;
    addressLine: string | null;
    city: string | null;
    postalCode: string | null;
  };
}

/**
 * The print/PDF nabídka route (ADR 0087, the M surface). RSC: fetches the quote
 * as the user (per-rep scope server-side, cookie forwarded), builds the pure-data
 * `NabidkaDocument` (ADR 0085) off the FROZEN snapshot — no re-derive, so the
 * printed sheet is byte-consistent with the issued quote (I3) — and lays it out.
 * Protected by the proxy gate; a 401/404/price-blind snapshot fails closed.
 */
export default async function NabidkaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const client = await createServerApiClient();

  let quote: QuoteDetail | undefined;
  try {
    quote = await client.apiFetch<QuoteDetail>(`/v1/quotes/${id}`, {
      parse: (data) => quoteSchema.parse(data),
    });
  } catch {
    notFound();
  }
  if (!quote) notFound();

  const snap = quote.snapshot as NabidkaSnapshot | null;
  // No tax/money ⇒ the price-blind workshop projection (ADR 0056); the priced
  // nabídka is not theirs to render.
  if (!snap?.tax || !snap.money) notFound();

  const customer: NabidkaCustomer | null = snap.customer
    ? {
        name: snap.customer.name,
        ico: snap.customer.ico,
        dic: snap.customer.dic,
        addressLine: snap.customer.addressLine,
        city: snap.customer.city,
        postalCode: snap.customer.postalCode,
      }
    : null;

  const doc = buildNabidka(
    snap.site,
    { bom: snap.bom, money: snap.money },
    { documentNumber: quote.documentNumber, tax: snap.tax, customer },
  );

  return <NabidkaDocumentView doc={doc} backHref={`/quotes/${id}`} />;
}
