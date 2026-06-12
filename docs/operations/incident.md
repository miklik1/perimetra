# Incident response

First-response playbooks keyed to the golden signals in
[OBSERVABILITY.md](../../OBSERVABILITY.md). The architecture's async machinery
(outbox → relay → queues) has exactly three failure shapes — lag, failed
growth, pool saturation — and each has a known first move.

## First five minutes (any incident)

1. **Is it down or degraded?** `GET /health/live` (process up) and
   `GET /health/ready` (Postgres + Redis reachable) on the api. Worker health
   shows up as outbox lag / queue depth, not an endpoint.
2. **Did we just deploy?** If the incident window starts at a rollout:
   rollback first, diagnose second — rollback is always safe (previous image;
   schema stays compatible, [deploy.md](deploy.md)).
3. **Pull the thread:** every error response carries an `x-request-id`; logs
   are JSON on stdout with `request_id` + `trace_id`/`span_id`; Sentry events
   carry the same request id. One id walks log → trace → Sentry.
4. Check the four golden signals below; the failing one selects the playbook.

## Playbook: `outbox.lag_seconds` / `outbox.pending` rising

Lag > relay interval × 10 (default interval 500ms) means domain events are
not flowing — realtime pushes, emails, analytics, webhooks all sit behind
this. THE async-machinery alarm.

1. **Is a worker running at all?** The relay lives in the worker deployable
   only. Zero workers = lag grows linearly forever. Restart/scale the worker;
   lag drains automatically (`pending` rows re-relay, no data lost — that is
   the point of the outbox).
2. **Worker up but lag still growing?** Read worker logs for relay errors —
   the relay catches and logs per-batch failures
   (`OutboxRelayService`). Usual suspects: Redis unreachable (enqueue fails →
   `attempts` climbs), Postgres connection trouble.
3. **Check for poison rows:**
   `SELECT count(*) FROM outbox WHERE status = 'dead';` — rows go `dead`
   after 10 failed publish attempts so they stop blocking the stream.
   Inspect, fix the cause, then requeue:
   `UPDATE outbox SET status = 'pending', attempts = 0 WHERE status = 'dead' AND <your filter>;`
4. **Lag draining but slowly?** A huge backlog drains at
   batch (50) per interval (500ms) per worker ≈ 100 events/s/worker — scale
   workers horizontally (SKIP LOCKED makes N relays safe, ADR 0037) or
   temporarily lower `OUTBOX_RELAY_INTERVAL_MS`.

## Playbook: `queue.jobs{state="failed"}` growing

Failed jobs went through their BullMQ retries and lost; each one also fired a
Sentry event (the DLQ convention, ADR 0043).

1. **Open bull-board** at `/admin/queues` (basic auth via
   `BULL_BOARD_USER`/`BULL_BOARD_PASSWORD`; **non-prod only** — in production
   the board never mounts, so triage via a port-forwarded staging replica
   against the same Redis, or Redis CLI). Read the failure reason on the
   failed jobs — it's usually one bug, N occurrences.
2. **Classify:** transient dependency (SMTP/S3/Centrifugo down) vs. code bug.
   Transient → fix/wait out the dependency, then replay. Bug → ship the fix
   first; replaying into a broken processor just re-fails.
3. **Replay** (ADR 0043 procedure): bull-board → failed jobs → retry. Safe by
   construction: payloads are IDs-only and processors re-fetch current state;
   consumers are at-least-once. A replay of work that meanwhile succeeded is
   a no-op read, not a double write.
4. **`waiting` growing instead of `failed`?** Consumers are behind, not
   broken: worker down (see outbox playbook step 1) or under-provisioned —
   scale workers.

## Playbook: `db.pool.connections{state="waiting"}` sustained > 0

Requests are queueing for a connection — latency climbs across ALL routes at
once (distinguishes this from a single slow endpoint).

1. **Do the ADR 0038 math first:**
   `DATABASE_POOL_SIZE (10) × (api replicas + worker replicas) < Postgres max_connections`
   (typically ~100 managed, minus the provider's reserve). If a scale-out
   broke the invariant, that's the whole incident: lower pool size, reduce
   replicas, or front with PgBouncer in transaction mode (the code is
   transaction-pooling-safe by construction — no session GUCs, no
   LISTEN/NOTIFY, no prepared-statement reliance — so PgBouncer is a config
   change, not a refactor; the compose `pgbouncer` profile mirrors it).
2. **Invariant fine? Look for hogs:**
   `SELECT pid, state, now() - query_start AS age, left(query, 80) FROM pg_stat_activity WHERE state <> 'idle' ORDER BY age DESC;`
   Long-running queries in a _request_ path are a bug (long work belongs in
   the worker); `statement_timeout` (30s pool-wide) eventually clears them,
   but 30s × pool size is already an outage.
3. **Genuine load growth:** raise pool size _within_ the invariant, add
   replicas, or add PgBouncer — in that order of effort.

## Playbook: RED anomalies (rate/errors/duration per route)

1. **Error spike on one route:** Sentry groups it; the request id links the
   failing trace. 422s spiking = a client/contract regression, not a server
   fire.
2. **Latency spike, one route:** open the route's trace
   (`OTEL_EXPORTER_OTLP_ENDPOINT` collector) — the slow span names the
   dependency (pg / ioredis / S3 / Centrifugo HTTP).
3. **Latency spike, all routes:** that's the pool playbook above (or the
   database itself — check the provider's dashboard).
4. **429s:** throttle tiers doing their job (or set too tight —
   `THROTTLE_LIMIT` 100/min/user, `AUTH_RATE_LIMIT_MAX` 10/min/IP on
   `/auth/*`, ADR 0044). Sustained 429s from one IP is abuse, not an
   incident.

## Degraded-but-up notes

- **Centrifugo down:** the api **fails soft** on publish (realtime is a
  notification channel, not a source of truth) — requests keep succeeding,
  clients just miss live updates and fall back to refetch. Fix Centrifugo;
  nothing to replay (missed publishes are not queued — by design).
- **SMTP down:** email jobs retry, then land in failed → replay per the queue
  playbook once the provider is back.
- **Redis lost entirely:** see the doctrine section of
  [backup-restore.md](backup-restore.md) — it's a re-relay, not a restore.

## After the incident

Write the timeline while it's fresh (what fired, what was tried, what fixed
it), file the action items, and if the incident revealed a missing alert —
the golden-signal list in OBSERVABILITY.md is where it gets added. Template
default: blameless, one page, lives with the project (not the skeleton).
