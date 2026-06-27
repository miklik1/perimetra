# ADR 0086 — Freeze the buyer identity onto the issued quote snapshot

**Status:** Accepted (2026-06-27). Implements the ADR-0071 posture for the buyer
side. No schema change (snapshot JSONB). The exact retained field-set + statutory
period remain the **non-blocking accountant check** ADR 0071 opened.

## Context

`issue()` attached a customer (ADR 0082) but persisted only `quote.customer_id`
— a FK to the **mutable, erasable** customer row. Nothing buyer-identifying was
frozen. Two problems follow:

- **ADR 0071 unrealized.** ADR 0071 decided that an issued daňový doklad retains
  its buyer-identifying fields _in the immutable snapshot_ under the
  legal-obligation basis (Art.17(3)(b)), so an Art.17 erasure of the live
  customer never alters or erases the issued document. With only a FK, the
  document had no retained buyer at all.
- **Drift / loss.** Rendering the nabídka (ADR 0085 / the PDF surface) by
  re-reading the live customer would make a "frozen" legal document mutate when
  the customer is edited, and lose its buyer entirely once the customer is
  anonymized (the live row is scrubbed to `[erased]` + soft-deleted, so it 404s
  from scoped reads).

## Decision

Freeze a `customer` block into the immutable `QuoteSnapshot` at issue, copied
from the attached customer:

`{ customerId, name, ico, dic, vatPayer, addressLine, city, postalCode, country }`

- **A captured fact, not a derived artifact.** Unlike `bom`/`money`/`tax`/
  `stamps`, the frozen buyer is NOT re-derivable from the immutable stores, so it
  is deliberately **absent from the `verifyReproducibility` `checks[]`**. I3
  holds unchanged: a quote whose customer was since anonymized still reproduces
  byte-identically (proven in `quotes.itest.ts`).
- **Retained through Art.17.** The snapshot lives on the immutable quote row,
  which the customer module never touches on erasure (`customer.erase` anonymizes
  only the live row; `quote.customer_id` is `ON DELETE RESTRICT`). So the frozen
  buyer survives the live customer's anonymization automatically — exactly the
  ADR-0071 split (live = erasable record of truth; issued document = retained
  legal record).
- **Document-identity field-set only.** `email`/`phone`/`note` are NOT frozen
  (data minimisation — contact, not document identity). `vatPayer` is frozen
  because it is the §92e legal-basis driver (and the tax mode is itself already
  frozen in `snapshot.tax`, per-transaction).
- **Workshop-blind.** `blindSnapshot` is a whitelist; `customer` is not on it, so
  the price-blind workshop role never receives buyer PII. The snapshot's zod seam
  stays `z.unknown()` passthrough (authorized-issuer data, stripped server-side
  for workshop) — no validator/migration change.

## Consequences

- The web quote detail + the nabídka renderer (ADR 0085) and its PDF surface read
  `snapshot.customer` — a stable, frozen buyer, never the mutable row.
- **PROVISIONAL (accountant-gated, ADR 0071 open check):** the EXACT retained
  field-set (is `email`/`phone` required on the document? IČO/DIČ obligations) and
  the statutory period. Recorded as the standing `**CHECK**` in the hub `## Now`.
- No new column, no migration; the field is additive + optional on the snapshot
  type (absent for walk-in quotes with no attached buyer).

Related: ADR 0071 (immutable-PII retention posture), ADR 0082 (customer entity),
ADR 0083 (lifecycle), ADR 0085 (nabídka renderer), ADR 0055 (anonymize-not-delete
/ I3 durability), CORE_SPEC I3.
