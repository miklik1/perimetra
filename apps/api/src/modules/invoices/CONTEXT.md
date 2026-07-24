# invoices — the §29 daňový doklad (ADR 0112, ADR-O2)

The SECOND frozen document class after the quote (ADR 0053). An issued invoice
is an immutable, re-derivable legal artifact: it never copies or mutates the
quote, it references the `order` (→ the accepted quote's frozen snapshot) and
freezes two JSONB payloads of its own — `facts` (the exact `BuildInvoiceInput`)
and `snapshot` (the `ExportableDocument` the kernel built from it).

All CZ tax derivation lives in the shared `@cardo/tax-cz` kernel. This module
owns exactly one numeric responsibility: the koruna↔haléře reconciliation in
`invoice-mapper.ts` (`korunaToHalere`). Never re-derive VAT here.

## Public surface

- `POST /v1/invoices` — issue from an order (admin/sales, `@Idempotent()`).
  Every guard runs BEFORE the číselná-řada number is burned; an issued tax
  document is irreversible.
- `GET /v1/invoices` / `GET /v1/invoices/:id` — list/detail (admin/sales).
- `POST /v1/invoices/:id/mark-paid` / `unmark-paid` — admin-only, idempotent.
  Payment is ROW STATE (`status`/`paid_at`/`paid_note`), never document content.
- `POST /v1/invoices/:id/verify` — the I3 harness: re-run `buildInvoice` over
  the frozen `facts`, deep-equal the frozen `snapshot`, name the diverging keys.

## Rules that bite

- **Reads are org-scoped AND owner-narrowed** (ADR 0041/0055 + ADR 0082). The
  repository's `scoped(scope, {restrictToOwner})` always filters
  `organization_id` and additionally filters `owner_id = scope.userId` for any
  non-admin role. `owner_id` is the ISSUER (stamped from the scope at freeze).
  Another rep's invoice **404s, never 403s** — a 403 would confirm the document
  exists, which is itself a disclosure.
- **Issue reads its basis org-wide on purpose.** `orders.assertIssuableForInvoice`,
  `quotes.getInvoiceBasis` and `customers.getIdentityForInvoice` are org-scoped
  and deliberately NOT owner-narrowed: invoicing is an org act (a stand-in rep
  must be able to invoice a colleague's completed order), and the customer read
  must include an anonymized row so the §29 guard fails CLOSED instead of
  mis-reading a 404. Do not "tighten" these without re-reading ADR 0112 §7.
- **Visibility is not I3.** The owner narrowing changes WHICH rows a caller may
  read; it never touches what was frozen or how it re-derives. For every row a
  caller may see, `verify` answers exactly as it did before — I3 is a property
  of the row, not of the reader.
- **`korunaToHalere` has one deliberate IEEE-754 hop**, bounded and proved on
  the function's own docblock; its precondition (≤4 decimal places, enforced by
  the price table's `roundingPolicy.scale` cap) is pinned by tests in
  `invoice-mapper.test.ts`. Do not "simplify" it into a second rounding rule —
  the kernel's `buildInvoice` contract requires the consumer to round through
  `roundHalfAwayFromZero`.
- `findByIdSystem` is the sole scope-less read: the worker event handler
  re-fetches from an IDs-only payload (ADR 0037) and has neither scope nor role.

## KNOWN GAP — the frozen buyer PII is NOT in the `pii()` registry

`invoice.facts` and `invoice.snapshot` carry the buyer's full §29 identity
(name, IČO, DIČ, e-mail, address) frozen at issue. Both are declared as plain
`jsonb()` in `@repo/db/schema/invoices` — **neither goes through `pii()`**, and
this module registers **no `PRIVACY_HANDLERS` entry** at all. Consequences,
today:

- the registry-driven GDPR export/erasure fan-out (ADR 0040) does not see this
  PII, so ADR 0071's promised partial-erasure acknowledgement — "report WHICH
  buyer data was retained and under WHICH basis (Art.17(3)(b))" — is not
  implemented for invoices;
- the log/Sentry redactor is built from `piiBodyKeys()` (literal `res.body.<col>`
  paths), so an invoice detail response body is **not** redacted.

**This is deliberately out of scope of the ADR-0082 owner narrowing.** The
narrowing is an ACCESS-CONTROL fix (who may read the row); it does nothing for
the registry or the redactor, and reading it as a redaction fix would be wrong.
Closing the gap is an immutable-store retention question governed by
**ADR 0071** (`docs/adr/0071-immutable-snapshot-pii-retention.md`): the buyer fields on an
issued document are retained under the legal-obligation basis, so the fix is
NOT "register and erase" — it needs the retained field-set declared, an invoices
privacy handler that exports linkage-only and refuses erasure with a recorded
basis, and a redaction path that reaches inside the JSONB. That is its own
slice; the accountant-gated field-set/period check ADR 0071 records is its
prerequisite.

## Must never

- Re-derive CZ VAT locally, or invent a second rounding rule at the kernel seam.
- Mutate `facts`/`snapshot` after freeze. A wrong invoice is SUPERSEDED (the
  `superseded_by_id` chain), never updated and never tombstoned — there is no
  soft-delete on this table.
- Join across module schemas — the order/quote/customer/legal-profile reads all
  go through the owning module's exported service (ADR 0032).
- Emit outside the transaction, or put PII in an outbox/job payload (IDs only —
  the handler re-fetches).

Governing ADRs: `docs/adr/0112-invoice-frozen-document-class-and-tax-cz-seam.md`
(the invoice slice), `0082` (per-rep
ownership), `0071` (immutable-PII retention), `0055` (org scope + I3
durability), `0040` (GDPR/privacy/audit), `0037` (outbox), `0032` (module
schema ownership).
