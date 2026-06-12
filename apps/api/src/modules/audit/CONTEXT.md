# audit — append-only audit trail (ADR 0040)

GDPR Art. 30 records-of-processing + the answer to every client security
questionnaire: who did what to which entity, when, with a before/after diff
and the request id. Retention: 2y default, via a scheduled maintenance job.

## Public surface

- `AuditService.record(entry)` (actor, action, entity type/id, before/after,
  request id) — call it INSIDE the same `@Transactional()` scope as the
  mutation it documents (the reference module demonstrates this).
- Schema: `@repo/db/schema/audit` (owned here; UUIDv7 ids give chronology).

## Rules that bite

- Append-only: no update/delete paths exist or may be added — corrections
  are new entries.
- Diffs must respect the `pii()` registry — redact registered fields rather
  than snapshotting raw PII into a 2-year-retention table.
- Audit writes are part of the transaction: a mutation whose audit insert
  failed did not happen.

## Must never

- Import other modules' schemas or services — callers bring their own diff;
  audit knows entity type/id strings, not entities.
- Become a general event log — domain events belong to the outbox.

Governing ADR: `docs/adr/0040-gdpr-privacy-audit.md`.
