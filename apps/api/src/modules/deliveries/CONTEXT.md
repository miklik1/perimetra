# deliveries — buyer document delivery (ADR 0129, Wave A2)

The module that makes a document REACH a buyer. A rep presses "Odeslat
e-mailem" on a quote or an invoice; this module resolves the recipient live,
runs six ordered guards, freezes one `document_delivery` row, emits ONE
IDs-only outbox event, and the WORKER does the SMTP hop.

Nothing here derives, prices, freezes or renders a document. It composes four
EXISTING seams (`QuotesService.get` / `InvoicesService.get` + `getDocument` /
`OrdersService.get` → `QuotesService.getInvoiceBasis` /
`CustomersService.getDeliveryRecipient`) and adds a record of an outward act.

## Public surface

- `POST /v1/deliveries` — queue a send (admin/sales, `@Idempotent()`,
  method-level `@Throttle` 10/min). 201 with a PII-FREE record.
- `GET /v1/deliveries?documentType=&documentId=` — the send history of ONE
  document (admin/sales, keyset). Both filters are REQUIRED: there is
  deliberately no org-wide delivery feed.

There is no `POST /v1/quotes/:id/send`, no `POST /v1/invoices/:id/send`, no
preview endpoint, no resend route (a resend is another `POST /v1/deliveries`)
and **no public route**. A2 adds ZERO new public/anonymous surfaces — a
checkable criterion: `@Public()` still appears only on `HealthController`,
`QuotesPublicController` and the SessionGuard docblock.

## The carrier ruling (the decision that dominates this module)

- **Quote mail** genuinely DELIVERS the nabídka: it links the ALREADY-SHIPPED
  ADR-0089 public landing `/nabidka/:shareToken`, which renders the full priced
  document off the frozen snapshot and offers accept/decline. The subject's
  claim is fully backed by the payload.
- **Invoice mail is a NOTIFICATION** that names itself precisely: it states the
  ACT ("Vystavili jsme fakturu {number}"), carries the payment identification
  inline, carries an explicit "není to daňový doklad" sentence, and carries **no
  link and no button at all** (`link_path` is NULL for `documentType:"invoice"`
  by construction). _The invoice document itself is still hand-delivered — A2
  automates the notification, not the document._

A public token-credentialed invoice route was considered and REFUSED. It stays
gated behind (i) closing the ADR-0071 invoices privacy slice (`pii()` over the
frozen buyer identity + an invoices `PrivacyHandler` + a JSONB-reaching
redaction path — the invoices CONTEXT.md KNOWN GAP), (ii) the CAR-27 accountant
pass, and (iii) its own adversarial security review. Do not build it before all
three.

## Rules that bite

- **The order IS the contract.** Every guard runs, inside the transaction,
  strictly BEFORE `OutboxService.emit()` — the invoices module's "every guard
  runs before the number is burned" discipline restated for an outward act. A
  refused send must leave NO event row; an event the handler silently drops
  would be the "silently not sending" failure the ADR-0126 inversion forbids.
- **`customer_anonymized` is checked BEFORE `recipient_email_missing`.** An
  anonymized row already has `email = null`, and telling a rep to "add an e-mail
  address" would invite them to re-enter erased PII — an actual Art.17 defeat.
- **The recipient is read LIVE from `customer.email`**, in the request path,
  through the owning module's service. NEVER `invoice.snapshot.buyerEmail`,
  never `invoice.facts.buyer.email`, never a join. Three independent reasons:
  the customer column is the only `pii()`-registered CURRENT address; reading
  the frozen copy would turn the invoices module's documented KNOWN GAP into an
  ACTIVE unregistered-PII processing path (A2 must leave that gap exactly as
  wide as it found it); and an Art.17 anonymization nulls the live column, which
  structurally disarms any further send.
- **The outbox payload is exactly `{ deliveryId }`, one key.** The address never
  enters Redis (BullMQ job data) nor `outbox.payload`, so Redis stays
  non-PII-bearing and rebuildable (ADR 0037). Nothing at runtime enforces this —
  `payload` is `Record<string, unknown>` — so it is enforced by tests
  (`deliveries.service.test.ts` + the itest reads the `outbox` table directly).
- **The audit diff carries IDs only** (`documentType`, `documentId`,
  `documentNumber`, `customerId`). Constraint "to whom" is satisfied by an ID.
  The address NEVER lands in `audit.diff`.
- **`claimForSend` is a conditional UPDATE, not a read-then-write.** Delivery
  must be AT-MOST-once; every other handler in the repo is at-least-once-safe
  only because its side effect is a fire-and-forget Centrifugo publish. The
  BullMQ dedup jobId ages out an hour after success, so a naive handler would
  re-send to a real buyer.
- **The worker's catch does NOT rethrow.** A retry after the claim can never
  send (status is no longer `queued`), so it would be noise ending in a DLQ
  entry no rep sees. `markFailed(id, "smtp_error")` makes the failure VISIBLE on
  the rep surface, and the rep re-sends explicitly.
- **The raw SMTP error is never logged, persisted, rethrown or attached to a
  span.** A 5xx rejection routinely embeds the recipient address, and neither
  the pino redact paths (literal, depth-1) nor the Sentry scrubber
  (extra/contexts only) reaches `event.exception.value`. Only the normalized
  code `"smtp_error"` is stored.
- **"Sent" means SMTP ACCEPTED the message.** There is no bounce feedback loop,
  so no column, response field or UI string may claim "doručeno".
- **The response schema is the PII control.** `deliverySchema` declares no
  `recipientEmail`, no `linkPath` (a bearer credential) and no `failureReason`;
  `@ZodSerializerDto` strips them (ADR 0039). pino `redact` is literal-path and
  depth-1, so it would NOT reach an address nested inside `items[]` — omitting
  the field is what actually closes the leak class.

## GDPR / consent posture

`document_delivery.recipient_email` is the module's only `pii()` registration.
`deliveries.privacy.ts` keys on the PLATFORM USER (`ownerId`): export is
LINKAGE-ONLY (never the buyer address — a third party's data), erase is a
documented idempotent no-op. The BUYER's erasure runs through the customer-keyed
`DELETE /v1/customers/:id` → `anonymize` flow (ADR 0071).

There is **no suppression list, no bounce handling, no `List-Unsubscribe`, no
contact preference** anywhere in this system. A2 ships without them, and that is
defensible ONLY because the mail is strictly transactional: one document, one
named recipient, rep-initiated, no promotional content, no cadence. The moment a
reminder cadence or campaign lands (explicitly out of A2's scope) the absence
becomes a real defect. Art.17 anonymization is the only de-facto suppression
mechanism and it is a coarse one — all-or-nothing, org-admin-driven, it destroys
the customer record, and it is not a "stop mailing me" affordance for a buyer
who wants to keep doing business.

**PROVISIONAL (CAR-27 pass 2):** the accountant pass has not run. Sending a
document to a buyer is a fresh processing act; nothing in this module claims
legal correctness or compliance of that act, of the mail's characterisation, or
of the retention of `recipient_email`.

## Must never

- Read `snapshot.buyerEmail` / `facts.buyer.email` / `buyerEmail` anywhere.
- Put an address (or anything but `deliveryId`) in an outbox or job payload.
- Emit outside the `@Transactional()` scope, or emit before a guard.
- Add a `@Public()` route, a PDF/headless-browser dependency, a link to the
  invoice mail, or a subject naming the ARTIFACT rather than the ACT.
- Join across module schemas — every document fact comes from the owning
  module's exported service (ADR 0032). `document_id` is a deliberate
  FK-less polymorphic soft ref for exactly that reason.
- Log, persist or rethrow a raw SMTP error.

## May never import

`@repo/db/schema/{quotes,invoices,orders,customers,...}` — this module imports
`@repo/db/schema/deliveries` and shared helpers only (ADR 0032).

Governing ADRs: `0129` (this wave), `0089` (the public buyer nabídka this mail
links), `0112`/`0126`/`0127` (the invoice spine, the Wave-0 repairs, the invoice
surface `getDocument` projects), `0087` (no PDF dependency), `0082` (per-rep
ownership), `0071` (immutable-PII retention), `0055` (org scope), `0040`
(GDPR/privacy/audit + the `pii()` registry), `0037` (outbox), `0035` (the email
module), `0032` (module schema ownership), `0031` (api/worker split).
