import { notFound } from "next/navigation";

import { getQueryClient } from "@repo/api";
import { type InvoiceDocument } from "@repo/validators";

import { createInvoicesQueries } from "../../../../lib/invoices-queries";
import { createServerApiClient } from "../../../../lib/server-api";
import { FakturaDocumentView } from "./faktura-document";

/**
 * The printable §29 daňový doklad (ADR 0127) — the invoice print surface, the
 * traveler/nabídka precedent (ADR 0087/0108): browser `print()` → PDF, zero PDF
 * dependency. RSC: reads `GET /v1/invoices/:id/document` as the user
 * (`createServerApiClient` forwards the session cookie, so the ADR-0082 per-rep
 * narrowing runs server-side and another rep's invoice 404s), then lays the
 * FROZEN document out. The route suffix `/faktura` is in the shell's
 * `PRINT_SUFFIXES`, so the sheet renders CHROMELESS.
 *
 * There is deliberately NO field-by-field snapshot guard here (the nabídka page
 * needs one because it parses a raw `snapshot`). That is the whole point of the
 * zod-validated endpoint: the api has already parsed the frozen document and
 * answers 422 `invoice_document_unreadable` rather than shipping a partial one.
 * So every failure — 401, 403, 404, 422, a client-side parse miss — collapses
 * into `notFound()`: a broken document never renders half a §29 sheet in a
 * browser. `fetchQuery` (which THROWS) is deliberate — `prefetchQuery` would
 * swallow the failure into the cache and render an empty sheet.
 */
export default async function FakturaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const invoicesQueries = createInvoicesQueries(await createServerApiClient());

  let doc: InvoiceDocument | undefined;
  try {
    doc = await getQueryClient().fetchQuery(invoicesQueries.document(id));
  } catch {
    notFound();
  }
  if (!doc) notFound();

  return <FakturaDocumentView doc={doc} backHref={`/invoices/${id}`} />;
}
