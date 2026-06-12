# projects — THE reference resource (ADRs 0039–0041)

The example domain module every new resource copies — preferably via
`pnpm gen module`, which reproduces this exact 9-file dance: zod contract
(`@repo/validators/projects`) → controller → `@Transactional()` service →
org-scoped repository → own schema (`@repo/db/schema/projects`) → outbox
events → worker event handler (`projects-worker.module.ts`: realtime push) →
privacy handler → tests at every layer.

## Pattern highlights (what you're expected to imitate)

- Controller: zod-validated DTOs, keyset pagination, mandatory zod response
  serialization, `Idempotency-Key` support on create (ADR 0039).
- Service: `@Transactional()`; state change + `OutboxService.emit()`
  (IDs-only payload) + `AuditService.record()` in ONE transaction.
- Repository: scoped by the CLS-carried organization context (ADR 0041 —
  tenancy dormant but the seam is load-bearing); soft delete via `archived`.
- `projects.privacy.ts`: registers under `PRIVACY_HANDLERS` for GDPR
  export/erasure fan-out (ADR 0040).

## Must never

- Import other modules' schemas (`@repo/db/schema/auth` etc.) or repositories
  — cross-module reads go through the owning module's exported service.
- Emit events outside the transaction, or put PII in event/job payloads.

Governing ADRs: `docs/adr/0039-api-semantics.md`, `0040`, `0041`.
