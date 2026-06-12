# outbox — transactional outbox (ADR 0037)

Reliable at-least-once domain events. Write half (api + worker):
`OutboxService.emit()` writes the event row in the SAME transaction as the
state change — it **throws unless an ambient `@Transactional()` scope is
active**. Read half (worker only): `OutboxRelayService` polls in batches via
`SELECT … FOR UPDATE SKIP LOCKED` ordered by UUIDv7 id (safe across N
replicas, no double-publish; LISTEN/NOTIFY deliberately rejected), enqueues
each event on the `events` queue with `jobId = eventId` (dedup), and stamps
`published_at`. Rows carry `traceparent` so traces link back to the request.

## Public surface

- `OutboxService.emit(event): Promise<eventId>` — the ONLY way to publish a
  domain event. Payloads are IDs-only, never PII.
- `OutboxModule` (api) / `OutboxWorkerModule` (worker: relay +
  `events.processor.ts` dispatching to `DOMAIN_EVENT_HANDLERS` registrants +
  `maintenance.processor.ts` retention cleanup, 30d default).

## Must never

- Be bypassed: publishing to BullMQ/Centrifugo directly from a request
  handler loses the transactional guarantee.
- Import domain module schemas — it knows `@repo/db/schema/outbox` only;
  handlers re-fetch their own state by id.
- Gain LISTEN/NOTIFY or session state (breaks transaction-mode PgBouncer).

Governing ADR: `docs/adr/0037-transactions-outbox.md`.
