/**
 * Document-delivery store (ADR 0129, Wave A2) — the record of an OUTWARD act:
 * a rep pressed "send this document to the buyer", and this row is the evidence
 * of what went to whom, when, and whether SMTP took it.
 *
 * TWO DATA SUBJECTS meet on this row, exactly like `customer`:
 *  - the platform USER (the rep) via `owner_id` — a creator/audit ref;
 *  - the BUYER (a third party) via `customer_id` + `recipient_email`.
 * `deliveries.privacy.ts` keys on the FORMER and exports linkage only; the
 * buyer's Art.17 erasure runs through the customer-keyed anonymize flow
 * (ADR 0071), never here.
 *
 * WHY `recipient_email` IS STORED AT ALL: `customer.email` is mutable, so
 * `customer_id` alone loses the address a mail actually went to. Freezing the
 * address at claim time makes the record honest ("this went to this address on
 * this date"), stops an address change between request and send from
 * retargeting an in-flight mail, and lets the worker handler stay a pure leaf
 * that reads only its own module's schema (no cross-module read from a worker
 * that has no `RequestScope` — ADR 0032). It is `pii()`-registered, confined to
 * Postgres, and STRUCTURALLY absent from the wire (`deliverySchema` omits it and
 * `@ZodSerializerDto` strips it, ADR 0039).
 *
 * WHY `link_path` IS NOT `pii()`: it is a BEARER CREDENTIAL
 * (`/nabidka/<shareToken>`), not personal data — the same posture as
 * `quote.share_token`, which is likewise unwrapped. It must never reach a
 * response body or a log line, and the response schema is what enforces that.
 *
 * WHY `document_id` CARRIES NO FK: it is polymorphic across `quote.id` and
 * `invoice.id`, i.e. two OTHER modules' schemas. A constraint here would be a
 * cross-module schema edge (ADR 0032). It is a disposable soft natural-key ref
 * owned by this module — the `org_release_assignment` posture (ADR 0062).
 *
 * "SENT" MEANS SMTP ACCEPTED THE MESSAGE, never "delivered": there is no bounce
 * feedback loop anywhere in this system, so no column and no surface may claim a
 * delivery it cannot know (the ADR-0126 honesty inversion, applied to status).
 *
 * No soft-delete: the evidence of an outward act is not tombstonable. The only
 * writes after the insert are the three status transitions in
 * `deliveries.repository.ts`.
 *
 * PROVISIONAL (CAR-27 pass 2): the accountant pass has not run. Nothing here
 * claims legal correctness or compliance of the send act, of the mail's
 * characterisation, or of the retention of `recipient_email`.
 */
import { sql } from "drizzle-orm";
import { date, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { id, timestamps } from "../../columns.js";
import { pii } from "../../pii.js";
import { organization, user } from "../auth/index.js";
import { customer } from "../customers/index.js";

/** The two document classes A2 can deliver (kept in lockstep with
 *  `@repo/validators/deliveries`). Plain text column + `$type`, no DB enum. */
export const DELIVERY_DOCUMENT_TYPES = ["quote", "invoice"] as const;
export type DeliveryDocumentType = (typeof DELIVERY_DOCUMENT_TYPES)[number];

/** `queued` → `sending` (claimed by a worker) → `sent` | `failed`. */
export const DELIVERY_STATUSES = ["queued", "sending", "sent", "failed"] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export const documentDelivery = pgTable(
  "document_delivery",
  {
    id: id(),
    /** The rep who pressed send — creator/audit ref (ADR 0055). RESTRICT: the
     *  record of an outward commercial act outlives its actor (erasure
     *  anonymizes the user row, never cascades — ADR 0071). */
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    /** THE access scope (ADR 0041 seam, ADR 0055). RESTRICT for the same reason. */
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    documentType: text("document_type").notNull().$type<DeliveryDocumentType>(),
    /** Polymorphic soft ref (`quote.id` | `invoice.id`) — NO FK by design (see
     *  the module docblock). */
    documentId: uuid("document_id").notNull(),
    /** The human evidenční číslo the mail names — a document identifier, not
     *  personal data. */
    documentNumber: text("document_number").notNull(),
    /** The buyer, BY ID. RESTRICT — the linkage to the data subject must not
     *  silently vanish (an anonymized customer row is retained, never deleted). */
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customer.id, { onDelete: "restrict" }),
    /** THE recipient, frozen at claim time — the honest "to whom". Registered so
     *  GDPR export/erasure and the log/Sentry redactors see it. NEVER on the wire. */
    recipientEmail: pii("document_delivery.recipient_email", text("recipient_email").notNull()),
    /** Buyer locale. Null → `resolveLocale` falls back to DEFAULT_LOCALE (cs).
     *  A preference, not identity data — deliberately not `pii()`, like `user.locale`. */
    locale: text("locale"),
    /** `/nabidka/<shareToken>` for a quote; NULL for an invoice (the ADR-0129
     *  carrier ruling: the invoice notification carries no document link).
     *  A BEARER CREDENTIAL — never on the wire, never in a log line. */
    linkPath: text("link_path"),
    /** Invoice-only payment identification, frozen from the ADR-0127 document
     *  projection so the mail and the §29 sheet cannot disagree. All PII-free
     *  (the buyer's own obligation + the SUPPLIER's own IBAN — the org's data,
     *  deliberately unwrapped in `schema/legal-profiles`). */
    amountMoney: text("amount_money"),
    currency: text("currency"),
    variableSymbol: text("variable_symbol"),
    dueOn: date("due_on"),
    payToIban: text("pay_to_iban"),
    status: text("status").notNull().$type<DeliveryStatus>(),
    /** SMTP ACCEPTED the message. Not "delivered" — there is no bounce loop. */
    sentAt: timestamp("sent_at", { withTimezone: true }),
    /** A NORMALIZED operator code ("smtp_error"), never a raw SMTP message —
     *  a 550 embeds the recipient address. Never on the wire. */
    failureReason: text("failure_reason"),
    ...timestamps(),
  },
  (table) => [
    // THE list query: the send history of ONE document, keyset by id.
    index("document_delivery_org_doc_id_idx").on(
      table.organizationId,
      table.documentType,
      table.documentId,
      table.id,
    ),
    // The structural anti-double-click: a second POST while a send is still
    // QUEUED races to a 23505 → 409 `send_in_progress`. Deliberately scoped to
    // 'queued' ONLY (not 'queued','sending'): a worker that crashed mid-send
    // would otherwise block that document's re-send forever.
    uniqueIndex("document_delivery_inflight_uq")
      .on(table.documentType, table.documentId)
      .where(sql`${table.status} = 'queued'`),
  ],
);

export type DocumentDeliveryRow = typeof documentDelivery.$inferSelect;
export type NewDocumentDeliveryRow = typeof documentDelivery.$inferInsert;
