/**
 * Document-delivery contracts (ADR 0129, Wave A2) — the api↔frontend seam for
 * "send this document to its buyer by e-mail".
 *
 * The response shape here IS the PII control (ADR 0039 strip semantics): the
 * recipient ADDRESS, the send LINK (a bearer credential) and the SMTP failure
 * text are all deliberately absent from the wire, so they cannot reach a
 * response body, a `res.body` log line or a Sentry request payload — see the
 * per-field notes below. The rep learns the address from the customer record
 * they already may read.
 *
 * PROVISIONAL (CAR-27 pass 2): the accountant pass has not run. Nothing here
 * claims legal correctness or compliance of the send act.
 */
import { z } from "zod";

import { cursorQuerySchema, paginated } from "./api/pagination";
import { isoDatetime } from "./primitives";

/** The two document classes A2 can deliver (mirrors `@repo/db/schema/deliveries`). */
export const DELIVERY_DOCUMENT_TYPES = ["quote", "invoice"] as const;
export const deliveryDocumentTypeSchema = z.enum(DELIVERY_DOCUMENT_TYPES);
export type DeliveryDocumentType = z.infer<typeof deliveryDocumentTypeSchema>;

/** `queued` → `sending` → `sent` | `failed`. "sent" = SMTP ACCEPTED the
 *  message; there is no bounce loop, so nothing may claim "delivered". */
export const DELIVERY_STATUSES = ["queued", "sending", "sent", "failed"] as const;
export const deliveryStatusSchema = z.enum(DELIVERY_STATUSES);
export type DeliveryStatus = z.infer<typeof deliveryStatusSchema>;

/**
 * Send a document to its buyer. The recipient is NOT a parameter — it is
 * resolved server-side from the document's attached customer, LIVE, at send
 * time (ADR 0129): a client-supplied address would make an authed endpoint an
 * open relay, and a frozen one would mail a superseded address.
 */
export const sendDocumentSchema = z.object({
  documentType: deliveryDocumentTypeSchema,
  documentId: z.uuid(),
});
export type SendDocumentInput = z.infer<typeof sendDocumentSchema>;

/**
 * The delivery record as the rep surface sees it.
 *
 * DELIBERATELY ABSENT, each for a stated reason:
 * - `recipientEmail` — pino `redact` is literal-path and depth-1
 *   (`res.body.<key>`), so an address nested inside `items[]` would NOT be
 *   redacted. Omitting it closes the leak class STRUCTURALLY instead.
 * - `failureReason` — a DB-only operator code. `status: "failed"` is the whole
 *   signal the rep needs; keeping the column off the wire means an SMTP message
 *   (which routinely embeds the recipient) can never reach a log or Sentry.
 * - `linkPath` — a bearer credential (`/nabidka#<shareToken>`). Already on the
 *   quote detail response; re-shipping it in a second list is gratuitous.
 * - amount / variableSymbol / dueOn / payToIban — already on the invoice detail
 *   response. Not re-shipped.
 */
export const deliverySchema = z.object({
  id: z.uuid(),
  documentType: deliveryDocumentTypeSchema,
  documentId: z.uuid(),
  /** The human evidenční číslo the mail names — not personal data. */
  documentNumber: z.string(),
  /** The buyer, BY ID. The address itself never crosses this boundary. */
  customerId: z.uuid(),
  status: deliveryStatusSchema,
  /** When SMTP ACCEPTED the message — handed off, NEVER "delivered". */
  sentAt: isoDatetime.nullable(),
  createdAt: isoDatetime,
});
export type Delivery = z.infer<typeof deliverySchema>;

/**
 * The send history of ONE document. `documentType`/`documentId` are BOTH
 * REQUIRED — there is deliberately no org-wide delivery feed (least surface).
 * Keyset paginated by id (UUIDv7), newest-first; the cursor exists so there is
 * ONE list idiom in the repo, not two.
 */
export const listDeliveriesQuerySchema = cursorQuerySchema.extend({
  documentType: deliveryDocumentTypeSchema,
  documentId: z.uuid(),
});
export type ListDeliveriesQuery = z.infer<typeof listDeliveriesQuerySchema>;

export const deliveriesPageSchema = paginated(deliverySchema);
export type DeliveriesPage = z.infer<typeof deliveriesPageSchema>;
