# ADR 0043 — Jobs & scheduling: BullMQ conventions, repeatables-only cron, DLQ

**Status:** Accepted (2026-06-10). Implemented.

## Context

Every derived project needs background jobs and scheduled work on day one.
Unstandardized, the first project bolts on `@nestjs/schedule` — in-process
cron that fires once PER REPLICA, a silent correctness bug in the
horizontally-scaled deployment this skeleton targets.

## Decision

- **BullMQ via `@nestjs/bullmq`**; queues declared in the single `QUEUES`
  registry (`events` / `dlq` / `maintenance` + per-module queues later).
  Defaults: 5 attempts, exponential backoff, age-bounded
  `removeOnComplete`/`removeOnFail` (Redis memory stays bounded).
- **Repeatables-only cron:** BullMQ job schedulers (`upsertJobScheduler`,
  wrapped by `upsertScheduler()`) are the ONLY sanctioned cron — Redis-
  coordinated, replica-safe, self-registering on worker bootstrap.
  **`@nestjs/schedule` is banned.**
- **DLQ convention:** when retries are exhausted, the processor's `failed`
  hook re-adds the job to `dlq` with origin metadata (queue, jobId, name,
  failedReason, data). Replay = re-add to the origin queue from bull-board.
- **bull-board** mounted at `/admin/queues` behind basic auth, NON-production
  only (it lives on the raw Fastify instance, outside Nest guards — same
  constraint class as the Better Auth mount).
- **Domain event consumption:** the `events` processor dispatches to
  `DOMAIN_EVENT_HANDLERS` multi-providers (modules register handlers for
  their event types); unhandled types log a warning.
- **Connections:** BullMQ owns its Redis connections (config-derived,
  `maxRetriesPerRequest: null` as it requires); the auth/session client and
  the rate-limit client stay separate with fast-fail retry settings — three
  intentionally different reliability profiles on one Redis.

## Consequences

- Singleton/scheduled work is replica-safe by construction; the first
  scheduled job (outbox cleanup) ships as the reference.
- Failed work is visible (bull-board, DLQ) and replayable; nothing vanishes.
- Job payloads are IDs-only (ADR 0037/0040) — Redis remains rebuildable.
