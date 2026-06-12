# ADR 0038 — Zero-downtime migration doctrine + connection pooling

**Status:** Accepted (2026-06-10). Numbered per the design spec's ADR plan
(0033–0037 land with their phases).

## Context

The deploy contract is horizontally-scaled stateless containers — old and new
code WILL run concurrently against one schema at every deploy, on every
derived project, for years. Migrations-at-boot on N replicas is a race; an
unguarded `ALTER TABLE` is an outage. Separately, N api replicas × M worker
replicas × pool size collide with Postgres `max_connections` — the first wall
this architecture hits under load.

## Decision

**Migrations:**

- Run as a **one-shot container** (`dist/migrate.js`, same image as the api)
  _before_ the api/worker rollout — the platform-agnostic release phase.
  Never at app boot.
- **Expand/contract is mandatory:** every migration must be compatible with
  the previous code version (add-nullable → backfill → enforce; never rename
  in one step). Rollback is therefore always "previous image" — no down
  migrations.
- Migration SQL sets `lock_timeout = '5s'` (fail fast, retry the deploy —
  don't queue behind a long transaction while holding an ACCESS EXCLUSIVE
  intent). `CREATE INDEX CONCURRENTLY` for non-trivial tables.
- CI gates (live once the first migration exists): apply the full chain to an
  empty Testcontainers Postgres, then diff `drizzle-kit` introspection
  against `schema.ts` (drift gate).

**Pooling:**

- Small per-instance pools (`DATABASE_POOL_SIZE`, default 10);
  `poolSize × replicas < max_connections` is the deployment invariant,
  documented in ARCHITECTURE.md.
- **Transaction-pooling-safe by default** so fronting with PgBouncer
  (transaction mode — the compose `pgbouncer` profile mirrors it) is a config
  change: no session GUCs, no LISTEN/NOTIFY (this also shaped the outbox
  relay design, ADR 0037), no prepared-statement reliance (hence node-postgres
  over postgres.js, ADR 0032).
- `statement_timeout` (default 30s) set pool-wide; long-running work belongs
  in the worker, not in a request handler.

## Consequences

- Deploy order is fixed: migrate → roll api/worker. A failed migration aborts
  the rollout with the old version still serving.
- Schema changes take more steps (expand/contract) — the price of never
  taking downtime; the migration template encodes the pattern.
- LISTEN/NOTIFY-based designs are off the table repo-wide (poller patterns
  instead), keeping every component PgBouncer-compatible.
