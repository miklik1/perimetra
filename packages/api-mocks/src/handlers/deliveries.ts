import {
  listDeliveriesQuerySchema,
  sendDocumentSchema,
  type Delivery,
  type DeliveryDocumentType,
} from "@repo/validators";

import { MockHttpError, type MockRoute } from "../core/types";
import {
  DELIVERY_REFUSAL_IDS,
  hasQueuedDeliveryFixture,
  insertDeliveryFixture,
  listDeliveryFixtures,
  type DeliveryRefusalCode,
} from "../fixtures/deliveries";
import { findInvoiceFixture } from "../fixtures/invoices";
import { findQuoteFixture } from "../fixtures/quotes";

/**
 * Deliveries mock routes (ADR 0018, ADR 0129 Wave A2) over the /v1/deliveries
 * contract: the per-document send history and the one outward act. Single-tenant
 * mock — org + per-rep scoping is a no-op here; the real API narrows
 * (`scopeOpts(role)`, ADR 0082), so another rep's document 404s there, never
 * here. The role gate is likewise server-only: the rep surface hides the
 * affordance for `workshop`, and the api answers 403 regardless.
 *
 * Nothing is mailed. The queued row IS the whole observable effect of a POST,
 * exactly as it is in the real request path — the send itself happens in the
 * worker, off the outbox, and no mock tier models that.
 *
 * The refusal ORDER below mirrors the service's, because the order is part of
 * the contract: superseded before in-flight, and the buyer-state refusals ahead
 * of everything the rep could mistake for them.
 */
function paginate(
  items: Delivery[],
  searchParams: URLSearchParams,
): {
  items: Delivery[];
  nextCursor: string | null;
} {
  const limitRaw = Number(searchParams.get("limit") ?? "20");
  const limit = Math.min(100, Math.max(1, Number.isFinite(limitRaw) ? limitRaw : 20));
  const cursor = searchParams.get("cursor");

  // Fixed `id:desc` — newest first. The endpoint takes no `sort` param: the one
  // consumer wants the latest row, and a second ordering would be a second idiom.
  let rows = items;
  if (cursor) {
    const index = rows.findIndex((d) => d.id === cursor);
    rows = index >= 0 ? rows.slice(index + 1) : rows;
  }
  const page = rows.slice(0, limit);
  const nextCursor = rows.length > limit ? (page[page.length - 1]?.id ?? null) : null;
  return { items: page, nextCursor };
}

/** The document the send names, resolved through its own fixture store — the
 *  mock parity for "the access gate is the document read". Returns the two
 *  fields a delivery actually needs off it. */
function findDocument(
  documentType: DeliveryDocumentType,
  documentId: string,
): { documentNumber: string; supersededById: string | null } | undefined {
  if (documentType === "quote") {
    const quote = findQuoteFixture(documentId);
    return quote
      ? { documentNumber: quote.documentNumber, supersededById: quote.supersededById }
      : undefined;
  }
  const invoice = findInvoiceFixture(documentId);
  return invoice
    ? { documentNumber: invoice.documentNumber, supersededById: invoice.supersededById }
    : undefined;
}

const REFUSAL_MESSAGE: Record<DeliveryRefusalCode, string> = {
  customer_required: "the document has no attached customer — there is no one to send it to",
  customer_anonymized: "the attached customer was anonymized — cannot send them a document",
  recipient_email_missing: "the customer has no e-mail address on record",
};

function refusalFor(documentId: string): DeliveryRefusalCode | undefined {
  return (Object.keys(DELIVERY_REFUSAL_IDS) as DeliveryRefusalCode[]).find(
    (code) => DELIVERY_REFUSAL_IDS[code] === documentId,
  );
}

export const deliveryRoutes: MockRoute[] = [
  {
    method: "GET",
    pattern: "/v1/deliveries",
    handler: ({ searchParams }) => {
      // `documentType` + `documentId` are BOTH required — there is deliberately
      // no org-wide delivery feed, so an unfiltered read is a contract error
      // here just as it is server-side.
      const parsed = listDeliveriesQuerySchema.safeParse(Object.fromEntries(searchParams));
      if (!parsed.success) throw new MockHttpError(422, "INVALID_INPUT", "Invalid delivery query");
      const rows = listDeliveryFixtures(parsed.data.documentType, parsed.data.documentId);
      return { data: paginate(rows, searchParams) };
    },
  },
  {
    method: "POST",
    pattern: "/v1/deliveries",
    handler: async ({ getBody }) => {
      const parsed = sendDocumentSchema.safeParse(await getBody());
      if (!parsed.success) throw new MockHttpError(422, "INVALID_INPUT", "Invalid send input");
      const { documentType, documentId } = parsed.data;

      const refusal = refusalFor(documentId);
      if (refusal) throw new MockHttpError(422, refusal, REFUSAL_MESSAGE[refusal]);

      const document = findDocument(documentType, documentId);
      if (!document) throw new MockHttpError(404, "NOT_FOUND", "Document not found");

      // A forwarded stale offer must never be re-transmitted: the rep sends the
      // newer revision deliberately.
      if (document.supersededById) {
        throw new MockHttpError(
          409,
          "document_superseded",
          "the document has been superseded by a newer version",
        );
      }
      if (hasQueuedDeliveryFixture(documentType, documentId)) {
        throw new MockHttpError(
          409,
          "send_in_progress",
          "a send for this document is already in flight",
        );
      }

      const delivery = insertDeliveryFixture({
        documentType,
        documentId,
        documentNumber: document.documentNumber,
      });
      return { data: delivery, status: 201 };
    },
  },
];
