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

## Amendment (2026-07-14) — per-row delayed jobs are not boot-rebuilt; pair state-gating ones with a sweep backstop

The repeatables-only-cron decision above covers scheduled CRON. It says nothing
about per-row `queue.add(name, data, { delay })` jobs — the low-latency
mechanism a module reaches for to expire or release a single row (a hold, a
reservation, a lock) at a future time. Unlike an `upsertScheduler()` repeatable,
a delayed job is armed ONCE, at row creation, and is never re-armed at boot. A
Redis flush — or any dropped delayed job — therefore orphans whatever state it
was meant to release, silently and forever. This does not violate "Redis is
rebuildable" for repeatables (self-registering on every restart) or for
outbox/DLQ (payload-IDs-only, replayable from Postgres); it is a real gap
specific to per-row delayed jobs whose loss strands a stateful, scarce resource
rather than just a retryable message.

The fix is not "stop using delayed jobs" — they remain the right low-latency
mechanism. It is that any per-row delayed job identified as state-gating (its
loss leaves a row stuck occupying something scarce, not just a missed
notification) MUST pair with a `maintenance`-queue sweep-backstop repeatable:
reuse the exact fenced release path the delayed job's own processor calls, cut
off at `deadline + grace`, use a bounded batch, one transaction per row, and an
overdue gauge. The full pattern lives in `jobs/CONTEXT.md`.

Confirmed in production, not hypothetical: a sibling project's Redis-flush
incident left held rows occupying a scarce resource indefinitely until a second
repeatable sweep — reusing the delayed job's own fenced release path — shipped
as the backstop. The skeleton ships no per-row delayed job yet, so this is a
doc-only note; the first module that adds one should read this before shipping,
not after a flush.
