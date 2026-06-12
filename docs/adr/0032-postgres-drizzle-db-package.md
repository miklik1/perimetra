# ADR 0032 — PostgreSQL + Drizzle in `@repo/db`; per-module schema, enforced

**Status:** Accepted (2026-06-10).

## Context

The backend needs a relational store and an ORM whose conventions ten derived
projects will copy. Candidates: Prisma (DX, heavier runtime, join/pooling
care at scale), MikroORM (Nest-idiomatic, smaller ecosystem), Drizzle
(SQL-first, light runtime, zod synergy). The owner picked Drizzle in the
design dialogue; this ADR records the package design around it.

## Decision

- **PostgreSQL 17 + Drizzle, pinned to `1.0.0-rc.x`.** Starting on 0.45.x
  would buy an immediate RQB v1→v2 + casing-API migration when 1.0 lands;
  the RC is the lower-churn choice. Queries sit behind repositories, so
  even an RC regression is contained.
- **Driver: node-postgres (`pg`) `Pool`** — postgres.js prepares statements
  by default, which breaks behind transaction-mode poolers (PgBouncer);
  `pg` is the pooler-safe default (ADR 0038).
- **`@repo/db` is a BUILT package** (tsc → `dist/`, exports map points at
  `dist/`): consumable by Nest's tsc build and publishable for the template
  lifecycle. The frontend packages stay source-only (their bundlers
  transpile); this split is deliberate.
- **Schema is split per module** (`src/schema/<module>/`), exported as
  `@repo/db/schema/<module>`. The aggregate barrel (`@repo/db/schema`) exists
  for drizzle-kit/seeds/privacy tooling ONLY — app modules import their own
  schema subpath, enforced by ESLint when domain modules land. This is the
  load-bearing mechanism behind ADR 0031's "modules own their tables".
- **Column conventions** (`@repo/db/columns`): `id()` = UUIDv7 PK generated
  app-side (`uuidv7` package; PG 17 has no native generator) — time-ordered,
  doubling as keyset-pagination cursor and outbox ordering; `timestamps()`
  (timestamptz, `$onUpdate` app-side); `softDelete()` (partial-unique-index
  pattern documented; soft-deleted PII is still PII).
- **`pii()` registry** (`@repo/db/pii`): every PII column is declared at
  schema-definition time; the registry drives privacy export/erasure fan-out
  and log-redaction paths (ADR 0040). One declaration, N consumers.
- **`defineFactory`** (`@repo/db/factories`): the single test/seed data
  convention — sequenced deterministic defaults + per-call overrides, reused
  by dev seeds, Testcontainers suites, and demo data.
- **Explicit `createDb` factory** (no module-global connection — the ADR 0012
  philosophy): small per-instance pool (default 10), `statement_timeout`,
  and a **read-replica seam** (`withReplicas`, defaulting to the primary) so
  adding a replica is config, not a refactor.

## Consequences

- drizzle-kit owns migrations (plain SQL in `packages/db/migrations/`);
  execution doctrine is ADR 0038's.
- The `@nestjs-cls/transactional` Drizzle adapter declares a `drizzle-orm@^0`
  peer — our 1.0-rc pin installs with a warning and is exercised by the
  Testcontainers suite; the adapter is small enough to vendor if the 1.0 line
  breaks it.
- knip needs explicit entries for built-package subpath exports (the exports
  map points at `dist/`, which knip can't trace to `src/`).
