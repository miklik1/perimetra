# numbering — the shared gap-free document-number allocator (ADR 0109)

One counter table for every numbered document class the org issues. A
document number is a legal/commercial claim ("this is our seventh invoice of
2026"), so the sequence must be **gap-free**: the increment lives in the
issuing transaction, not next to it. `document_number_sequence(org, series,
year, last_number)` is a single atomic
`INSERT … ON CONFLICT DO UPDATE … RETURNING last_number` — no DB sequence, no
advisory lock, no session GUC, so it is transaction-pooling-safe by
construction.

The module owns the counter and the calendar; it does **not** own the human
string. Each document class renders its own series (`{year}/{seq:04d}` for a
nabídka, `Z{year}/…` for an order, `FV{year}/…` for a §29 invoice) in its own
`document-number.ts`, because the format is that class's legal convention, not
a numbering concern.

## Public surface

- `NumberingService.allocate(scope, series, year): Promise<number>` — the next
  value in the org's `(series, year)` sequence. `series` is the document class
  (`"quote"`, `"order"`, `"invoice"`); each is an independent counter that
  resets to 1 each year.
- `numberingYear(now?): number` — the wall-clock series year, pinned to
  **Europe/Prague**. Callers whose year is a wall clock (quote, order) MUST use
  it; the invoice path must NOT (see below).
- `NumberingModule` — import it and inject `NumberingService`. No controller
  (there is no "numbering" resource), no events, no worker.

## Invariants

- **Gap-free per (org, series, year).** `allocate()` writes on the AMBIENT
  transaction (`TransactionHost`, like `OutboxService`): it MUST run inside the
  caller's `@Transactional()` issue scope so the increment commits or rolls back
  **with** the document row. A guard that can reject an issue must therefore run
  BEFORE `allocate()` — a 422 after allocation would burn a number on a document
  that never existed.
- **Concurrent issues serialize** on the `(org, series, year)` primary-key row
  lock — two simultaneous issues get two distinct numbers, never a duplicate and
  never a hole.
- **The counter is not the record.** It is operational state (its org FK
  CASCADEs); the durable legal string lives on the immutable document row, each
  of which carries its own per-`(organizationId, <number>)` unique index
  (`quote_org_document_number_uq`, `order_org_number_uq`,
  `invoice_org_number_uq`) as the at-rest backstop. If the counter were ever
  lost or rebuilt, those indexes are what still make a duplicate impossible.
- **The year is Prague's, not the server's.** `numberingYear()` is the one
  source for a wall-clock series year, so quote and order series can never
  disagree across a New Year boundary on a UTC box. The invoice series is
  deliberately NOT a wall clock: its year is the DUZP year
  (`numberingYearFromDuzp`, `@cardo/tax-cz`), the tax period the supply belongs
  to — a December-DUZP invoice issued in January numbers in December's year.

## Must never

- Be called outside a transaction, or "pre-allocate" a number to show a user
  before the document exists — both reintroduce gaps.
- Import another module's schema or service (ADR 0032): it knows
  `@repo/db/schema/numbering` and the `(scope, series, year)` triple only. It
  has no idea what a quote or an invoice is, which is why one allocator can
  serve all of them.
- Grow a "reset"/"renumber" path. A wrong number is corrected by issuing a new
  document, never by rewriting the series.
- Hand out numbers from a DB sequence or `nextval` — those do not roll back, so
  a failed issue would leave a permanent hole.

Governing ADR: `docs/adr/0109-order-domain-and-numbering.md` (generalizing the
quote allocator of `docs/adr/0079-gap-free-numbering-series.md`).
