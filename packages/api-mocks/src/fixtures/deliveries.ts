import { type Delivery, type DeliveryDocumentType } from "@repo/validators";

/**
 * In-memory document-delivery store for the mock tier (ADR 0018, ADR 0129 Wave
 * A2). A delivery is the record of ONE outward act — "this document was mailed
 * to this buyer at this moment" — so the mock models exactly what the wire
 * carries and nothing more.
 *
 * THE RECIPIENT IS ABSENT ON PURPOSE, and this is the whole point of the shape.
 * `deliverySchema` omits `recipientEmail` / `failureReason` / `linkPath` by
 * construction (ADR 0129: strip semantics are the real PII control), so a mock
 * that invented them would be modelling a boundary the real api does not have —
 * and would put a buyer address into a fixture file for no reason at all.
 *
 * ids are uuidv7-shaped (lexicographic == creation order, the keyset-cursor
 * contract); `customerId` points at the seeded `fixtures/customers.ts` row.
 */

/** The seeded buyer every mock delivery is addressed to (Bartek Vrata s.r.o.). */
const MOCK_CUSTOMER_ID = "00000000-0000-7000-9000-000000000001";

/**
 * Document ids reserved as REFUSAL fixtures: a send for one of these always
 * answers with the named typed rejection.
 *
 * They exist because the real refusals derive from state the mock tier does not
 * model and should not fake — the seeded quotes all carry `customerId: null`,
 * there is no invoice→order→quote→customer chain here, and GDPR anonymization is
 * a server-side flow. Rather than wire a fake customer graph (which would make
 * the ordinary happy path refuse, since every seeded quote is buyer-less), the
 * mock names one document id per code so the rep surface's typed-rejection
 * rendering is exercisable end to end.
 *
 * Two codes are NOT here because the mock mirrors them faithfully instead:
 * `document_superseded` (read off the document's own `supersededById`) and
 * `send_in_progress` (an existing `queued` row — the mock parity for the
 * `document_delivery_inflight_uq` partial unique index).
 */
export const DELIVERY_REFUSAL_IDS = {
  customer_required: "00000000-0000-7000-8000-0000000f0001",
  customer_anonymized: "00000000-0000-7000-8000-0000000f0002",
  recipient_email_missing: "00000000-0000-7000-8000-0000000f0003",
} as const;

export type DeliveryRefusalCode = keyof typeof DELIVERY_REFUSAL_IDS;

/** The seeded quote with a send still in flight — drives the 409 `send_in_progress`. */
export const DELIVERY_QUEUED_QUOTE_ID = "00000000-0000-7000-8000-000000000003";
/** The seeded (paid) invoice with a completed send — drives the "Odesláno" state. */
export const DELIVERY_SENT_INVOICE_ID = "01930000-0000-7000-8000-000000000002";

function seedDelivery(index: number, over: Partial<Delivery>): Delivery {
  const seq = String(index).padStart(12, "0");
  const now = `2026-07-${String((index % 28) + 20).padStart(2, "0")}T09:00:00.000Z`;
  return {
    id: `01940000-0000-7000-8000-${seq}`,
    documentType: "quote",
    documentId: DELIVERY_QUEUED_QUOTE_ID,
    documentNumber: "2026/0003",
    customerId: MOCK_CUSTOMER_ID,
    status: "queued",
    sentAt: null,
    createdAt: now,
    ...over,
  };
}

let deliveries: Delivery[] = [];
let createSeq = 0;

function seed(): Delivery[] {
  return [
    // A completed send on the paid invoice — `sentAt` means SMTP ACCEPTED the
    // message, never "delivered": there is no bounce feedback loop.
    seedDelivery(1, {
      documentType: "invoice",
      documentId: DELIVERY_SENT_INVOICE_ID,
      documentNumber: "FV2026/0002",
      status: "sent",
      sentAt: "2026-07-22T09:00:05.000Z",
    }),
    // Still in flight — a second send for this document must 409.
    seedDelivery(2, {}),
  ];
}
deliveries = seed();

/** The send history for ONE document, newest first — there is no org-wide feed. */
export function listDeliveryFixtures(
  documentType: DeliveryDocumentType,
  documentId: string,
): Delivery[] {
  return deliveries
    .filter((d) => d.documentType === documentType && d.documentId === documentId)
    .sort((a, b) => b.id.localeCompare(a.id));
}

/** Whether a send for this document is still queued — the mock parity for the
 *  `document_delivery_inflight_uq` partial unique index (scoped to `queued`
 *  ONLY, so a crashed `sending` row never blocks a re-send forever). */
export function hasQueuedDeliveryFixture(
  documentType: DeliveryDocumentType,
  documentId: string,
): boolean {
  return deliveries.some(
    (d) => d.documentType === documentType && d.documentId === documentId && d.status === "queued",
  );
}

/** Queue a send. The mock hands nothing to a mail server — the row is the whole
 *  observable effect, exactly as it is in the request path server-side (the
 *  worker does the sending, off the outbox). */
export function insertDeliveryFixture(input: {
  documentType: DeliveryDocumentType;
  documentId: string;
  documentNumber: string;
}): Delivery {
  createSeq += 1;
  const delivery = seedDelivery(100 + createSeq, {
    documentType: input.documentType,
    documentId: input.documentId,
    documentNumber: input.documentNumber,
    status: "queued",
    sentAt: null,
    createdAt: new Date().toISOString(),
  });
  deliveries.push(delivery);
  return delivery;
}

export function resetDeliveries(): void {
  deliveries = seed();
  createSeq = 0;
}
