# ADR 0079 — Gap-free org-scoped document-numbering series

**Status:** Accepted (2026-06-25 — Phase A, the legal-document spine, step 2).
**Implementation:** Implemented (quote `issue` allocates the number inside its
transaction; the customer entity / tax layer / PDF build on it).

## Context

A CZ daňový doklad (and a serious _nabídka_) is legally defective without a
**gap-free sequential evidence number** (evidenční číslo) — a continuous,
per-issuer series with no holes. Phase A's quotes spine needs this as a
prerequisite to the PDF and the tax layer, not a rider (roadmap
[[Decision — enterprise-readiness gap analysis & phased roadmap]]).

The architecture forbids the obvious tool: per CLAUDE.md the system is
**transaction-pooling-safe** — **no DB sequences** (also: a sequence gaps on
rollback, the opposite of what we need, and isn't per-tenant), no session GUCs,
no advisory-lock reliance across statements. The number must also be allocated
**atomically with the quote insert** so a failed issue leaves no hole.

## Decision

A **per-org, per-year counter row** incremented by a single atomic statement
**inside the existing `issue` `@Transactional()`**:

- New table `quote_number_sequence(organization_id, year, last_number, …)`,
  PK `(organization_id, year)` — one counter per org per year (CZ series reset
  annually). Operational state, **not** a legal artifact: the org FK is `CASCADE`
  (the immutable `quote` rows carry I3 durability via `RESTRICT`, the counter
  need not).
- Allocation is one `INSERT … ON CONFLICT (org, year) DO UPDATE SET last_number =
last_number + 1 RETURNING last_number` (drizzle `onConflictDoUpdate`): inserts
  at 1 on first use, else increments. Because it runs in the issue transaction:
  - **gap-free** — a rolled-back issue rolls back the increment too;
  - **race-safe** — concurrent issues serialize on the `(org, year)` row lock,
    so each gets a distinct value;
  - **pooling-safe** — no sequence, no advisory lock, no session GUC.
- `quote.document_number text NOT NULL` (new column) stores the formatted string;
  a **unique index `(organization_id, document_number)`** is the structural
  backstop (no two quotes in an org can share a number even under a race).
- The displayed/legal number is rendered by one pure helper
  `formatQuoteNumber(year, seq)` → `{year}/{seq:04d}` (e.g. `2026/0001`) — the
  tax layer + PDF reuse it. Invoices (Phase B) get their own module/series.
- The wall clock (`new Date().getFullYear()`) lives in the app layer, like the
  share token — never the engine (determinism I1 preserved).

The number is a **row identifier assigned once at issue**, NOT part of the I3
re-derivation: `verifyReproducibility` re-runs the engine and compares its
outputs; `document_number` is not an engine output, so I3 is untouched (the
itest confirms reproduction still holds).

## Consequences

- The migration is **backfill-safe** (N-1 / non-empty-table safe): add the
  column nullable, backfill any pre-ADR rows with `LEGACY/{id}` (unique → the
  index holds), then `SET NOT NULL`. New quotes always get a real number.
- `quoteSummarySchema` gains `documentNumber` (surfaced on every quote
  response). The OpenAPI snapshot is unchanged — that doc only expands request
  bodies, not responses.
- Integration coverage: sequential gap-free allocation, a failed issue consuming
  no number, per-org independence, and concurrent issues serializing into
  distinct numbers (`quotes.itest.ts`).
- **Open accountant-confirmation check (non-blocking):** whether the nabídka
  series must be fully continuous vs per-year-reset for the eventual daňový
  doklad, and the exact format/prefix per document class. The per-year `{year}/{seq:04d}`
  default proceeds; the invoice series (Phase B) pins its own. → hub `## Now` CHECK.

Related: ADR 0053 (the quote I3 core / `issue` tx), ADR 0055 (org scoping,
RESTRICT durability), ADR 0071 (immutable-PII retention — the prior Phase-A
step), CORE_SPEC I3. Roadmap: Phase A step 2.
