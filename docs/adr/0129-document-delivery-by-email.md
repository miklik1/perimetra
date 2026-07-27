# ADR 0129 — Phase A Wave A2: document delivery by e-mail, and what an invoice mail may honestly claim

**Status:** Accepted (2026-07-25 — Phase A, Wave A2). Follows [ADR 0127](0127-invoice-surface-a1.md) (the invoice surface) and applies [ADR 0126](0126-phase-a-wave0-legal-tenancy-repairs.md)'s inverted contract-honesty rule to e-mail. Builds on [ADR 0035](0035-infra-modules.md) (the email seam), [ADR 0037](0037-transactions-outbox.md) (outbox), [ADR 0040](0040-gdpr-privacy-audit.md) (`pii()` + privacy handlers), [ADR 0082](0082-customer-entity-per-rep-ownership.md) (per-rep ownership) and [ADR 0089](0089-buyer-public-nabidka-view.md) (the public token-credentialed buyer landing).

## Context

The documents were reachable and unsendable. A rep hand-delivered a link. A2 makes a document reach a buyer's inbox through the existing `EmailService` extension seam.

The quote half is easy: [ADR 0089](0089-buyer-public-nabidka-view.md)'s public landing `/nabidka/:shareToken` already renders the full priced nabídka and offers accept/decline, so a mail linking it genuinely delivers the document.

**The invoice half has no carrier.** There is no public invoice route, and [ADR 0087](0087-nabidka-print-surface.md) forbids a PDF dependency. So the invoice mail can only be a link to a new public surface, or a notification. That choice is this ADR.

## Decision

### 1. The invoice mail is a NOTIFICATION that names itself precisely. No new public surface.

**A2 adds ZERO new public/anonymous surfaces.** `@Public()` appears on exactly two controllers repo-wide after this wave — `HealthController` and `QuotesPublicController` — which is a checkable acceptance criterion, not a claim.

Why not a token-credentialed public invoice route, in order of weight:

1. **You do not open an anonymous read over a store whose PII-registration gap is open and documented.** `apps/api/src/modules/invoices/CONTEXT.md` carries a self-declared KNOWN GAP: `invoice.facts`/`invoice.snapshot` freeze the buyer's full §29 identity through plain `jsonb()`, neither goes through `pii()`, and the invoices module registers **no** privacy handler. Closing it is an [ADR 0071](0071-immutable-snapshot-pii-retention.md) slice, explicitly out of scope of ADR 0126 and ADR 0127. Building an unauthenticated read over that table first would put a GDPR-invisible payload one token away from the open internet. That alone settles it.
2. **The exposure is materially more actionable than the nabídka's.** Relative to today's public boundary the new-in-kind fields are `variableSymbol` + `supplierBankAccount` + `supplierIban` + `dueDate` + `totalAmount` — together a complete, ready-to-execute payment instruction — plus `note`, a rep-authored 500-char free-text field frozen onto the document and the only uncontrolled-content channel on the surface. The nabídka carries a bank account but no VS, no due date and no payable total; the invoice combination is a qualitatively different target, handing a leaked token everything needed for a credible payment-redirection scam against a named buyer whose IČO/DIČ/address sit on the same page.
3. **The honesty gain is small and capped by ADR 0087.** With no PDF dependency, a public route would not deliver "the daňový doklad" either — it would deliver a web page rendering it, which is exactly what the authed print sheet already is. Trading a recorded "the document is hand-delivered" line for a second rendering of the same view is not worth a new anonymous trust boundary over a legal store.
4. **It has structural side effects on shipped invariants.** A `share_token` column needs a NOT-NULL backfill on the §29 legal table; the invoices repository would gain a second scope-less read, falsifying its CONTEXT.md's "`findByIdSystem` is the sole scope-less read"; ADR 0127 §8's `invoice_document_unreadable` 422 would need re-reasoning for an anonymous caller (the nabídka fails closed to 404 precisely to avoid an existence oracle); and `/invoices` is in `PROTECTED_PREFIXES`, so a public invoice route needs a new top-level path. That is a slice, not a sub-task.

**Recorded plainly: the invoice document itself is still hand-delivered. A2 automates the notification, not the document.**

A public token-credentialed invoice route stays possible, gated behind all three of: closing the ADR-0071 invoices privacy slice; the CAR-27 accountant pass; and its own adversarial security review.

### 2. How the mail satisfies the inverted honesty rule

The mislabel class ADR 0126 killed was a "Daňový doklad" heading over a nabídka — a label claiming more than the payload backs. The e-mail equivalent would be a subject like "Daňový doklad FV2026/0003" over a mail carrying neither the document nor a link to it. Three defences, each pinned by a test in `email.service.test.ts`:

- **The subject names an ACT, never an artifact** — `Vystavili jsme fakturu {number}`. It never contains "daňový doklad".
- **The body carries an explicit disclaimer** — _"Tento e-mail je oznámení o vystavení faktury, není to daňový doklad. Samotný doklad vám předá váš obchodní zástupce."_
- **The mail carries no link and no button, by construction** — the template exposes no `href` prop, and `link_path` is NULL for `documentType: "invoice"`. The test strips the XHTML DOCTYPE first (its public identifier is itself a `http://www.w3.org/…` URL) and then asserts no `http://` and no `href=`, so the assertion is real rather than vacuous. A mail with no link cannot imply the document is one click away.

The same disclaimer is surfaced to the **rep** on the send panel, so nobody in the chain believes they mailed the doklad.

Every figure in the mail is read from the FROZEN document through ADR 0127's `getDocument` projection — never re-derived, never read live off `legal_profile` — so the mail and the printed sheet cannot disagree. The amount is the kernel's own `totalAmount` string interpolated verbatim; a second money formatter for e-mail is forbidden by the 2026-07-14 no-duplication ruling, and the visible consequence (dot-decimal money in a Czech mail, matching the sheet exactly) is an accepted cost, not an oversight. It resolves with §13 of ADR 0127 when the accountant pass rules on money presentation.

### 3. Sending is asynchronous, off the outbox, with an IDs-only payload

The request path claims a `document_delivery` row and emits inside `@Transactional()`; the worker handler does the SMTP hop. A slow or failing mail server can neither fail nor stall a rep's action.

**The job/outbox payload is exactly `{ deliveryId }` — one uuid.** The recipient address never enters Redis or `outbox.payload`, so Redis stays non-PII-bearing and rebuildable (ADR 0037).

### 4. The recipient is read live from the customer, never from the frozen document

`customer.email` through a new minimal `CustomersService.getDeliveryRecipient` seam (id + address + an erased flag), org-scoped and including an anonymized row so the caller fails **closed** on an erased buyer rather than mis-reading a 404 — the ADR 0112 §7 posture. Three independently sufficient reasons:

1. It is the only `pii()`-registered, GDPR-reachable, **current** address. `snapshot.buyerEmail` is a historical fact about the document; mailing it would mail a superseded address.
2. Reading the frozen field would convert the invoices module's documented KNOWN GAP into an **active unregistered-PII processing path**, making the ADR-0071 slice a prerequisite of A2 rather than a follow-up. **Hard rule: no A2 code path reads `snapshot.buyerEmail` or `facts.buyer.email`.** A2 leaves that gap exactly as wide as it found it.
3. An Art.17 anonymization nulls `customer.email` in place, so a live read structurally disarms the send — a coarse but genuine suppression mechanism in a system that has no unsubscribe list.

`document_delivery.recipient_email` is `pii()`-registered with its own privacy handler, and `recipientEmail` is kept off **every** API response so it cannot reach a log line. The email seam deliberately gains no logger: a rejected-recipient SMTP error routinely embeds the address, and neither the pino body paths nor the Sentry scrubber reaches an exception message — so the seam throws and the handler persists a normalized `smtp_error` code, logging an id and never the error.

### 5. `AbortError` is no longer logged as a network error

Found by the eyes-on pass, not by a test: the new delivery-state query made every ordinary navigation away from a document detail page emit `apiFetch network error … AbortError: signal is aborted without reason` — 12 console errors across one navigation sweep. React Query cancels in-flight queries on unmount; a cancellation is not a failure. `createApiClient` now suppresses the log for `AbortError` while still throwing, so control flow is unchanged. Logging expected cancellation as an error is how a console gets loud enough that people stop reading it. **This is a shared `packages/api` file — it is owed upstream to the skeleton (channel A).**

## Consequences

- A rep can send a nabídka (which genuinely delivers the document) and an invoice notification (which does not claim to). Both are auditable and idempotent; a re-send is deliberate and explicit.
- **`document_delivery` is a pure-expand migration** — one new table, no column added to an existing one, no backfill, therefore trivially N−1 safe. `RESTRICT` FKs on owner/organization/customer: evidence of an outward commercial act must survive user/tenant deletion, and GDPR erasure anonymizes rather than cascades (ADR 0071). `document_id` deliberately carries no FK — it is polymorphic over `quote.id | invoice.id`, i.e. two other modules' schemas (ADR 0032), a soft natural-key ref with the `org_release_assignment` posture. The partial unique index is scoped to `status='queued'` only, so a worker that crashed mid-send can never block that document's re-send.
- **Open, for Martin — none blocking:** `EMAIL_FROM` still has no production sender domain (it defaults to a dev-safe loopback address, and a real sending domain is one of the ADR-0113 account-gated items); whether an Art.17 erasure should also scrub `recipient_email` on historical delivery rows (they are evidence of a commercial act — arguably retained, like an invoice); whether the rep should see the recipient address before sending (A2 keeps it off every response, so a wrong address cannot be caught at the moment of sending); at-most-once vs at-least-once on a transient SMTP failure (A2 claims the row before the hop and does not rethrow, so a blip needs an explicit re-send rather than an automatic retry — a mail may be visibly marked failed rather than silently duplicated); and the buyer locale, which always resolves to `cs` because a customer is not a `user` and has no `locale` column (the column exists on `document_delivery` and is passed verbatim, so nothing hardcodes `cs`).
- The invoice-mail carrier decision is revisitable, but only behind the three gates in §1. It should not be reopened casually.
