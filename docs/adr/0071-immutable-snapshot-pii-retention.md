# ADR 0071 — Immutable-snapshot PII retention vs Art.17 erasure

**Status:** Accepted (2026-06-23, Martin's call — the human-gated Phase-A
prerequisite). Posture decided; the exact retained field-set + statutory period
are a **non-blocking accountant-confirmation check** (does not gate the build).
Not yet implemented — the gating decision for Phase A (legal-document spine).

## Context

Phase A introduces a **customer entity** (`odběratel`, PII) and a **quotes web
surface** that issues a CZ quote/daňový doklad. Three forces collide:

- **I3 byte-reproducibility** — an issued quote is a frozen, immutable snapshot;
  `verifyReproducibility` must re-derive it byte-identically _forever_ (the
  customer-facing trust feature). The buyer-identifying fields ON the issued
  document are part of that snapshot.
- **GDPR Art.17 erasure** — a data subject can request erasure of their personal
  data.
- **Statutory accounting retention** — a CZ tax/accounting document must be kept
  ~10 years (zákon o účetnictví / o DPH). This is a **legal obligation**, which
  Art.17(3)(b) makes an explicit exemption FROM the erasure right for the data
  the obligation covers.

A naive "erase everything on request" would destroy legally-required tax records
and break I3; a naive "keep everything" would violate erasure for data not under
the obligation. The existing I3 stores already chose anonymize-not-delete
(ADR 0055): the `user`/quote/price_table rows are `ON DELETE RESTRICT` +
PII-anonymized, never hard-deleted, so frozen commercial records survive while
their author goes PII-free.

## Decision

Extend that stance to customer/document PII:

- **An ISSUED quote/invoice retains its buyer-identifying fields** for the
  statutory accounting period under the **legal-obligation basis** (Art.17(3)(b)).
  Those fields live in the immutable snapshot and are **NOT erased** on an Art.17
  request — erasure is lawfully refused for them, with that basis recorded. I3
  reproducibility is therefore never broken by erasure.
- **GDPR erasure anonymizes only the LIVE customer entity and any UN-ISSUED
  drafts/quotes** (no legal obligation attaches to those) — the same
  anonymize-at-the-row pattern as ADR 0055, registered via `pii()` and the
  privacy handler (and per ADR 0070's lesson: a new PII/credential table needs an
  EXPLICIT delete/anonymize in `eraseUser`, since the cascade never fires on an
  anonymized row).
- **The customer entity is the erasable record of truth; the issued document is
  the retained legal record.** A customer who is "erased" keeps their frozen
  issued documents (retained, lawful) but is anonymized everywhere a legal
  obligation does not attach.

## Consequences

- The privacy export/erase fan-out gains a customer handler (anonymize live +
  drafts; retain + record-basis for issued docs). The erase response must report
  _which_ data was retained and _why_ (the Art.17(3)(b) basis) — a partial-erasure
  acknowledgement, not a silent no-op.
- The customer entity carries an erasure/anonymized marker so the live record can
  be PII-free while issued documents that reference it stay intact (FK
  RESTRICT/anonymize, like the I3 quote author).
- **Open accountant-confirmation check (non-blocking):** the EXACT retained
  field-set on the document (which buyer fields the obligation covers) and the
  EXACT period (likely 10y; confirm 5 vs 10 per document class). The build
  proceeds on the posture above; the field-set/period are parameters the ADR
  records and the accountant pins. → tracked as a `**CHECK**` in the hub `## Now`.

Related: ADR 0055 (owner→org anonymize-not-delete, I3 durability), ADR 0040
(privacy/audit plumbing), ADR 0070 (anonymize-needs-explicit-purge lesson),
CORE_SPEC I3. Roadmap: [vault] Decision — enterprise-readiness gap analysis &
phased roadmap (Phase A, step 1).
