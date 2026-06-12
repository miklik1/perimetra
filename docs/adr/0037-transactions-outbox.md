# ADR 0037 — Ambient transactions + transactional outbox

**Status:** Accepted (2026-06-10). Implemented and live-proven (two-relay
concurrency test over real Postgres).

## Context

Reliable domain events are the architecture's service-extraction bet (ADR
0031): an event must be published iff its state change committed. Without an
enforced mechanism, code (human or AI) writes outbox rows outside the business
transaction — silently converting at-least-once into maybe-never.

## Decision

- **Ambient transactions:** `@nestjs-cls/transactional` + its Drizzle adapter.
  Services declare `@Transactional()`; repositories and the outbox writer
  resolve the ambient `tx` from CLS via `TransactionHost`.
- **Enforced atomicity:** `OutboxService.emit()` accepts ONLY the ambient
  transactional client and THROWS outside an active transaction — the wrong
  thing doesn't run.
- **Relay (worker deployable):** 500ms poll; per batch, in one transaction:
  `SELECT … FOR UPDATE SKIP LOCKED ORDER BY id LIMIT 50` → enqueue to BullMQ
  with `jobId = event id` (dedup) → mark `published`. SKIP LOCKED partitions
  claims across N replicas — proven: two concurrent relays, 20 events, zero
  double-publishes. LISTEN/NOTIFY rejected (ADR 0038: pooling-safe; the poll
  costs ~2 cheap queries/sec).
- **Failure modes:** enqueue errors increment `attempts`; rows go `dead` at 10
  (poison rows surface, never block the stream). Consumers treat delivery as
  at-least-once and MUST be idempotent (jobId dedup frees after job pruning).
- **Hygiene:** UUIDv7 ids give FIFO order per batch; `traceparent` column
  carries trace context into jobs (wired Phase 6); published rows are deleted
  after 30 days by a scheduled job; **payloads carry IDs, never PII** —
  processors re-fetch, which keeps Redis non-PII-bearing (ADR 0040) and
  ephemeral (backup doctrine).

## Consequences

- Domain modules get reliable events for one line inside their transaction.
- Per-aggregate global ordering is NOT guaranteed across batches/retries —
  consumers needing strict ordering must sequence on their own state.
- The CLS Drizzle adapter peers `drizzle-orm ^0` vs our 1.0-rc — exercised by
  the live test; vendorable (~50 lines) if the 1.0 line breaks it.
