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
- **A per-row DELAYED job (`queue.add(name, data, { delay })`) is armed once at
  row creation and is NEVER re-armed at boot** — unlike an `upsertScheduler()`
  repeatable (self-registering on every restart), a Redis flush or any dropped
  delayed job permanently orphans whatever state that job was meant to release.
  Before adding one, ask: what does its LOSS leave behind? A row left occupying a
  scarce resource (a hold, a lock, a reservation) needs the sweep-backstop
  pattern below; a job whose only effect is a notification (a reminder) does not
  — the from-state-fenced handler alone is enough.
- Job payloads carry IDs, never PII — processors re-fetch. Redis stays
  non-PII-bearing and rebuildable ("Redis is ephemeral" doctrine).
- Exhausted jobs land on `dlq` with origin metadata + a Sentry event (replay
  procedure in the ADR). Singletons: jobId dedup or pg advisory locks only.

## Sweep-backstop pattern (per-row delayed jobs that gate state)

A per-row delayed job identified as state-gating (see above) needs a second,
independent safety net — proven in production, not hypothetical (a sibling
project's Redis flush left rows stuck occupying a resource forever until this
shipped):

1. A second `maintenance`-queue repeatable — its own `upsertScheduler()`
   registration, its own cadence + grace env vars — separate from the delayed
   job so the two tune independently.
2. Cutoff `= deadline + grace`: only a row still stuck past the grace window is a
   straggler, so the backstop never races the delayed job on its normal path
   (which fires within seconds of the deadline).
3. The sweep calls the EXACT SAME fenced release method the delayed job's own
   processor calls — never a parallel code path — so a row a healthy job already
   resolved is a clean idempotent no-op.
4. Each release commits in its own transaction (one bad row never rolls back the
   batch), with a bounded batch size per tick and a partial index on the
   deadline column so the scan stays cheap.
5. A golden-signal gauge — same shape as `outbox.pending` / `outbox.lag_seconds`
   (ADR 0036, `otel/metrics.module.ts`) — counts rows past deadline WITHOUT the
   grace; a sustained `> 0` means delayed jobs are being lost faster than the
   backstop clears them.

The skeleton ships no per-row delayed job yet, so no sweep code exists here —
this is the spec to reach for the day a module adds one (ADR 0043 amendment
2026-07-14).

## Must never

- Import domain module schemas or services — dependency points the other way.

Governing ADR: `docs/adr/0043-jobs-scheduling.md`.
