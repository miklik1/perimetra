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
- Repository: `scoped()` filters on `organizationId = scope.organizationId`
  (ADR 0041 seam, activated ADR 0055 — `ownerId` retained as creator/audit ref);
  soft delete via `archived`.
- `projects.privacy.ts`: registers under `PRIVACY_HANDLERS` for GDPR
  export/erasure fan-out (ADR 0040).

## Site persistence (step 6.3c)

- A project IS a designed site: `project.site` (opaque Site-graph JSONB, NULL
  until designed) + the `project_instance` roster (release pin + config input +
  opaque overrides), keyed to the graph's placements by `instanceId`.
- `project_instance` is a CHILD of `project` (FK `ON DELETE CASCADE`) and has
  **no ownership scope of its own** — it is only ever read/written through the
  owning project, whose `scoped()` filter is the access gate. `saveSite`
  confirms ownership via `updateSite` (404 on miss) BEFORE touching the roster,
  and replaces site + roster in ONE `@Transactional()` so they never diverge.
- `GET/PUT :id/site` are full-document (the canvas holds the whole site in
  memory); PUT is naturally idempotent, so no `Idempotency-Key`. The site blob
  is never engine-validated at the boundary — the engine is the validation gate
  (I5) and invalid-but-editable sites are legitimately persisted. The roster
  entry mirrors `quoteInstanceInputSchema`, so a saved project feeds
  `quotes.issue` directly. The site-persistence contracts live in
  `@repo/validators/project-site` — kept OUT of the skeleton-owned `projects.ts`
  so that reference file stays byte-comparable for channel-A drains (ADR 0042).

## Must never

- Import other modules' schemas (`@repo/db/schema/auth` etc.) or repositories
  — cross-module reads go through the owning module's exported service.
- Emit events outside the transaction, or put PII in event/job payloads.

Governing ADRs: `docs/adr/0039-api-semantics.md`, `0040`, `0041`.
