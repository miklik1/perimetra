# jobs — BullMQ wiring & conventions (ADR 0043)

Infrastructure module: registers the BullMQ connection, declares every queue,
and mounts bull-board. Domain modules declare processors in their own
`*-worker.module.ts`; this module owns the shared plumbing and the rules.

## Public surface

- `QUEUES` registry (`jobs.tokens.ts`) — `events`, `dlq`, `maintenance`,
  `privacy`. Every queue is declared HERE; one source of truth for worker,
  producers, and the board.
- `DOMAIN_EVENT_HANDLERS` multi-provider token + `DomainEventHandler`
  interface — how domain modules subscribe to outbox events.
- bull-board at `/admin/queues` behind basic auth, **non-prod only**.

## Rules that bite

- **Repeatable jobs are the only cron** — `@nestjs/schedule` is banned
  (in-process cron fires once per replica).
- Job payloads carry IDs, never PII — processors re-fetch. Redis stays
  non-PII-bearing and rebuildable ("Redis is ephemeral" doctrine).
- Exhausted jobs land on `dlq` with origin metadata + a Sentry event (replay
  procedure in the ADR). Singletons: jobId dedup or pg advisory locks only.

## Must never

- Import domain module schemas or services — dependency points the other way.

Governing ADR: `docs/adr/0043-jobs-scheduling.md`.
