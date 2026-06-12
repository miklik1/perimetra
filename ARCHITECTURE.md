# Architecture

TypeScript fullstack monorepo: a **NestJS 11 (Fastify) modular-monolith
backend** shipping as one image with three commands (api / worker / migrate),
a **Next.js 16 web app**, and an **Expo SDK 56 mobile app** (dormant) that
share logic, types, and design tokens — never rendered UI. Built as a
template for client projects with scalability as the structural priority:
stateless containers, a transactional outbox, strict ESLint-enforced module
boundaries that reach into the database schema.

This document is the stack overview and the constraints cheat-sheet. Every
non-obvious decision has an ADR — the index with per-ADR implementation
status lives at [`docs/adr/README.md`](docs/adr/README.md) (0001–0030
inherited from the frontend base; backend decisions start at 0031). Ops
runbooks: [`docs/operations/`](docs/operations/) (backup/restore, deploy,
incident). Observability: [OBSERVABILITY.md](OBSERVABILITY.md). Security:
[SECURITY.md](SECURITY.md).

## Stack

| Layer     | api (`apps/api`)                                                                    | Web (`apps/web`)                                            | Mobile (`apps/mobile`, dormant)             |
| --------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------- |
| Framework | NestJS 11 on Fastify 5, ESM (NodeNext, `.js` imports)                               | Next.js 16 (App Router, RSC) + Turbopack                    | Expo SDK 56 (RN 0.85) + expo-router         |
| Data      | PostgreSQL 17 + Drizzle `1.0.0-rc` (node-postgres pool), Redis 7 + BullMQ           | TanStack Query over `@repo/api`                             | TanStack Query over `@repo/api`             |
| Contract  | zod v4 in `@repo/validators` via nestjs-zod; OpenAPI 3.1 generated + snapshot-gated | same zod schemas (forms, parsing)                           | same zod schemas                            |
| Auth      | Better Auth (pinned), mounted manually on Fastify; httpOnly cookie sessions         | `@repo/auth` Better Auth client wrapper                     | Better Auth Expo plugin (wired, dormant)    |
| UI        | —                                                                                   | shadcn/radix + plain DOM, Tailwind v4                       | RN primitives, NativeWind v5 (exact pin)    |
| Tests     | Vitest 4 unit + Testcontainers integration (`test:integration`)                     | Vitest 4 + Playwright (mock-mode E2E + real-stack `@smoke`) | Jest + jest-expo + RNTL; Maestro scaffolded |

Infra (dev compose in `docker/`, services in prod): Centrifugo ≥ 6.8.1
(realtime), MinIO/S3 (objects), Mailpit/SMTP (email), optional PgBouncer
profile. Observability is three non-overlapping layers — PostHog (what users
do), Sentry (what broke), OpenTelemetry (why it's slow) — each off until its
env var is set.

## Deployables: modular monolith, one image, three commands

`docker/api.Dockerfile` builds one backend image (ADR 0031); the command
selects the role:

- **`dist/main.js` (api)** — HTTP on `:4000`, `/v1` URI versioning, Better
  Auth at `/api/auth/*`, terminus health (`/health/live`, `/health/ready`),
  helmet, 1MB body limit, throttle tiers, graceful shutdown.
- **`dist/worker.js` (worker)** — separate Nest app context: BullMQ
  processors, the outbox relay, repeatable (cron) jobs, bull-board (non-prod).
  No HTTP.
- **`dist/migrate.js` (migrate)** — one-shot release phase, runs **before**
  rollout, never at boot (ADR 0038). Rollback = previous image; schema stays
  N−1 compatible, no down migrations.

Both long-running deployables are stateless; all shared state lives in
Postgres/Redis. Day-one microservices were rejected deliberately — but every
module stays _extractable_ because boundaries are enforced down to the schema
(below). See [`docs/operations/deploy.md`](docs/operations/deploy.md) for the
two blessed deploy recipes (managed PaaS, self-hosted compose).

### Backend module map (`apps/api/src/modules/`)

| Module      | Role                                                                                                                                                                                                                                                                                                                            |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `projects`  | **the reference resource** — the pattern every new module copies (and `pnpm gen module` reproduces): zod contract → controller → `@Transactional()` service → scope-aware repository → `@repo/db/schema/projects` → outbox events → worker processor → realtime push → audit entry → privacy handler → unit + integration tests |
| `auth`      | Better Auth manual Fastify mount; Drizzle adapter (`@repo/db/schema/auth`); Redis secondary storage; admin plugin (ban/impersonate) behind guard; org plugin tables generated, dormant                                                                                                                                          |
| `outbox`    | `OutboxService.emit()` (ambient tx only) + the worker-side relay (`FOR UPDATE SKIP LOCKED` batches, `jobId = eventId` dedup, dead-letter after 10 attempts, 30-day cleanup)                                                                                                                                                     |
| `jobs`      | BullMQ queue registry + conventions; bull-board behind basic auth (non-prod)                                                                                                                                                                                                                                                    |
| `email`     | `EmailSender` seam + SMTP adapter; react-email templates rendered locale-aware through `@repo/i18n` catalogs                                                                                                                                                                                                                    |
| `storage`   | S3 presigned upload/download with type/size constraints; orphan-cleanup job; AV-scan seam                                                                                                                                                                                                                                       |
| `realtime`  | Centrifugo connection/subscription JWTs + HTTP-API publish (fail-soft); channels `user:<id>` / `org:<id>`                                                                                                                                                                                                                       |
| `analytics` | server-side PostHog (`posthog-node`): domain-event capture + `evaluateFlags()` over the shared `@repo/flags` registry                                                                                                                                                                                                           |
| `audit`     | append-only audit log (actor, action, entity, diff, request-id); 2-year retention sweep                                                                                                                                                                                                                                         |
| `privacy`   | GDPR jobs: `exportUser` / `eraseUser` fan-out over the `PrivacyHandler` registry (driven by the `pii()` column registry; covers auth tables, S3, Sentry, PostHog)                                                                                                                                                               |
| `health`    | terminus liveness/readiness (Postgres + Redis)                                                                                                                                                                                                                                                                                  |
| `webhooks`  | **seam** (ADR 0034): outbound-webhook signing + delivery (`WebhookDispatcher`) and the outbox→webhook bridge; endpoint registry/delivery log stay project-owned — recipe in its README                                                                                                                                          |
| `billing`   | **seam** (ADR 0034): provider-agnostic `BillingProvider` interface (`Customer`/`Subscription`/`Entitlement`) + noop binding + webhook-to-outbox recipe; no provider SDK, no tables, no UI                                                                                                                                       |

Cross-cutting machinery lives in `src/common/` (config/env, db provider,
exception filter, idempotency interceptor, logging/redaction, tenancy CLS,
throttle) plus `src/openapi/`, `src/otel/`, `src/sentry/`.

## Package map (`packages/`, all `@repo/*`)

Backend-coupled:

- **`db`** — Drizzle schema **split per module** (`@repo/db/schema/<module>`
  entry points: `auth`, `outbox`, `audit`, `projects`), shared column helpers
  (`id` UUIDv7, `timestamps()`, `softDelete()`, **`pii()`** — registers the
  column in the PII registry that drives export/erasure and log/Sentry
  redaction), pool factory (`withReplicas` seam), plain-SQL migrations
  (expand/contract, `lock_timeout = '5s'` template), typed test/seed
  factories. Importable only by `apps/api` (boundaries-enforced).
- **`ai`** — thin LLM seam (ADR 0034): `ChatModel`/`EmbeddingModel`
  interfaces, a `createAiRouter` composition point, noop defaults, and two
  recipes (Vercel AI SDK adapter — the SDK itself is deliberately NOT
  installed — and the pgvector/Drizzle embeddings convention). A seam, not a
  chatbot.
- **`validators`** — zod schemas + API contract types; the single source of
  runtime truth on both sides of the wire, incl. `paginated(schema)` and the
  filter/sort grammar.
- **`flags`** — ONE typed flag registry across React, RSC, NestJS, and
  workers, with per-flag consent annotations; PostHog adapters.

Frontend/shared (the split-UI model — logic and types, never pixels; one
package per responsibility, ADR 0008, DAG enforced by
`eslint-plugin-boundaries`, ADR 0011):

- **`api`** — REST data layer: `createApiClient` factory + `ApiError`
  taxonomy, `defineQuery`/`defineMutation`/`defineInfiniteQuery` →
  TanStack Query options, pluggable terminal fetch (RSC resolves the proxy
  in-process), envelope seam (ADR 0030).
- **`auth`** — Better Auth **client** wrapper (ADR 0033): `useAuth`,
  `AuthGuard`, provider; session cookies are httpOnly and same-origin via the
  proxy — no client token machinery.
- **`api-mocks`** — framework-agnostic mock routes + MSW adapter; frontend-only
  dev mode and the named convention for mocking third-party HTTP in tests.
- **`i18n`** — next-intl (web) + use-intl (mobile + the **worker's
  locale-aware emails**) over shared ICU catalogs.
- **`realtime`** — vendor-neutral `RealtimeClient` contract + Centrifugo
  adapter + deterministic mock; `useChannel`/`useConnectionState`.
- **`telemetry`** — vendor-agnostic capture/analytics seams (Sentry/PostHog
  bindings); **`utils`** — logger (+ `LogSink`) and Intl formatting;
  **`config`** — typed env per platform; **`navigation`** — typed route
  registry + zod search params; **`ui`** — web-only shadcn DOM; **`store`** —
  Zustand app-shell state (theme, toasts).

`tooling/` holds build configs (tsconfig/eslint/prettier/tailwind/vitest/CI
setup); `turbo/generators/` holds the scaffolders — `pnpm gen module` emits
the full reference-resource pattern, `package`/`api-resource`/`route` carry
over from the base.

## Data flow

```
browser ── same-origin /api/* ──► Next.js (rewrites/BFF)
                                    │  /api/auth/* ────────────► Better Auth (on api)
                                    │  /api/v1/*  ── strip /api ► api /v1/* (NestJS)
RSC ───── server-to-server fetch ──┘                               │
mobile ── direct API URL ──────────────────────────────────────────┤
                                                                   ▼
                              zod pipe → controller → @Transactional() service
                                                                   │
                                              ┌─── one Postgres tx ┴───┐
                                              │  state change (Drizzle) │
                                              │  + outbox row (+ audit) │
                                              └───────────┬─────────────┘
                                                          │ poll 500ms, SKIP LOCKED
worker ◄── BullMQ (Redis, jobId = eventId) ◄── outbox relay (worker)
   │
   ├─► Centrifugo HTTP API ──► websocket ──► browser (user:<id> channels)
   ├─► EmailSender (SMTP) — locale-aware react-email
   ├─► PostHog (server-side capture), S3, …
   └─► repeatables: outbox cleanup, audit retention, orphaned uploads
```

Same-origin is the security model: the browser only talks to the web origin
(httpOnly session cookies, no CORS); Fastify runs `TRUST_PROXY` so throttling
keys on real client IPs. WebSockets are the one exception — they bypass the
proxy straight to Centrifugo, authenticated by api-minted JWTs. Reads skip
the async machinery (controller → service → repository → response); only
side-effects ride the outbox.

## Constraints cheat-sheet

### Backend rules (the ones reviews enforce)

- **Every mutation is `@Transactional()`.** Repositories and the outbox
  writer resolve the ambient CLS transaction; `OutboxService.emit()` _only_
  accepts the ambient transactional client — an event outside a transaction
  does not compile (ADR 0037).
- **Side-effects go through the outbox** — never publish to
  Redis/Centrifugo/SMTP directly from a request handler. State change + outbox
  row commit atomically; the relay delivers at-least-once.
- **Job payloads are IDs-only, never PII** (ADR 0043) — processors re-fetch.
  This is what makes Redis ephemeral and rebuildable
  ([the doctrine](docs/operations/backup-restore.md)).
- **Cron = BullMQ repeatables only.** `@nestjs/schedule` is lint-banned
  (in-process cron fires once per replica). Singleton work: job-id dedup or
  pg advisory locks.
- **Keyset/cursor pagination by default** (UUIDv7 makes it free); offset only
  as a documented exception. One filter/sort grammar from `@repo/validators`
  (ADR 0039).
- **Every response passes a zod response schema** (strip semantics) — an
  unvalidated Drizzle `select()` shipping `passwordHash` is the leak class
  this kills. The same schemas generate OpenAPI 3.1 (snapshot-gated).
- **Personal-data columns use `pii()`** — the registry drives privacy
  export/erasure, log redaction, and the Sentry scrubber. A bare `text()`
  holding an email is a bug (ADR 0040).
- **Modules own their tables.** `modules/X` may import only
  `@repo/db/schema/X` (+ shared column helpers) — ESLint-enforced. Cross-module
  reads go through the owning module's exported service; never joins across
  module schemas. New tenant-scoped tables carry `organizationId` and go
  through the scoped-repository pattern (ADR 0041).
- **Transaction-pooling-safe by default** (ADR 0038): no session GUCs, no
  LISTEN/NOTIFY, no prepared-statement reliance — PgBouncer stays a config
  change. The deployment invariant:
  `DATABASE_POOL_SIZE (default 10) × (api + worker replicas) < Postgres max_connections`
  — recheck it on every scale-out, or front with PgBouncer.
- **Migrations: expand/contract, always N−1 compatible** (add-nullable →
  backfill → enforce; never rename in one step); `lock_timeout = '5s'`;
  `CREATE INDEX CONCURRENTLY` on non-trivial tables; run via `migrate.ts`,
  never at boot.
- **Domain-layer posture** (stated once): transaction-script services are
  fine; extract a repository when a query is reused; no mandatory DDD
  ceremony. Copy `modules/projects`; run `pnpm gen module`.
- Long-running work belongs in the worker (`statement_timeout` 30s pool-wide);
  generated files carry `@gen:*` anchors — don't delete them.

### Frontend rules (carried from the base, condensed)

- Web: Tailwind v4 + shadcn DOM, server components by default, `"use client"`
  at interactive leaves only; no react-native(-web) on web; no shared rendered
  UI across platforms.
- Semantic tokens only (`bg-background`, never raw palette); all tokens live
  once in `@repo/tailwind-config/theme` (OKLCH `@theme`).
- Mobile: NativeWind v5 pinned **exact**; SDK pins via `expo install --check`;
  never hand-pin RN/Expo libs; AsyncStorage, no native modules (Expo
  Go-compatible, ADR 0015).
- Data fetching through `@repo/api` builders + the query-key factory; forms =
  RHF + `@repo/validators` schemas (no forms package, ADR 0009); server state
  in TanStack Query, app-shell UI state in `@repo/store`, domain state in its
  domain package.
- Package DAG is law (`eslint-plugin-boundaries`): no `api → telemetry`, no
  `flags/realtime → auth` — cross-cutting identity/tokens are injected at
  composition roots.

## Decisions (ADRs)

The full index — every ADR with status and as-built implementation state —
lives at [`docs/adr/README.md`](docs/adr/README.md). Orientation: **0001–0030**
are the inherited frontend-era decisions (split UI, data layer, i18n,
telemetry, flags, realtime seam); **0031+** are the backend and fullstack
decisions — start with [0031](docs/adr/0031-nestjs-modular-monolith-worker-split.md)
(monolith + worker), [0032](docs/adr/0032-postgres-drizzle-db-package.md)
(db package + boundaries), [0033](docs/adr/0033-better-auth.md) (auth),
[0037](docs/adr/0037-transactions-outbox.md) (transactions + outbox),
[0038](docs/adr/0038-zero-downtime-migrations-pooling.md) (migrations +
pooling), and [0039](docs/adr/0039-api-semantics.md)–[0044](docs/adr/0044-security-baseline-supply-chain.md)
(API semantics, GDPR, tenancy, lifecycle, jobs, security).

## Build status

The fullstack build plan
([`docs/superpowers/plans/2026-06-10-fullstack-skeleton-plan.md`](docs/superpowers/plans/2026-06-10-fullstack-skeleton-plan.md))
is **shipped — phases 1–8**:

1. **Re-baseline** — frontend base imported (provenance in README), Node 24 /
   pnpm 11 / Vitest 4, ESM-ready posture.
2. **Foundations** — `docker/` dev stack, `@repo/db` (per-module schema,
   column helpers, factories, migration template), the api shell
   (Fastify/config/health/pino+redaction/filter/CLS), one-image Dockerfile.
3. **Auth** — Better Auth manual mount, proxy topology, `@repo/auth` client
   refactor, CSRF integration test.
4. **Async core** — outbox + relay, BullMQ conventions, email, storage,
   realtime.
5. **Conventions made concrete** — pagination/idempotency/serialization,
   audit + privacy + tenancy seam, the `projects` reference resource,
   `pnpm gen module`.
6. **Observability** — OTel traces/metrics (outbox-aware context propagation),
   Sentry, server-side PostHog, OBSERVABILITY.md.
7. **Quality net** — Testcontainers integration suite, real-stack smoke E2E in
   CI, OpenAPI snapshot gate, k6 baseline (`loadtest/`), supply-chain gates
   (gitleaks, Trivy, audit).
8. **Template lifecycle & docs** — create-project stamp-out, thin seams,
   agent docs, ops runbooks, this rewrite.

### Honest deferred list

Known gaps, deliberate — each has its trigger to close:

- **Org channels fail closed.** `org:<id>` subscription tokens are DENIED:
  the tenancy seam exists (CLS scope, scoped repositories, dormant org
  tables) but membership checks don't yet. Closing it = Better Auth org
  plugin activation + flipping the repository scope from owner to membership,
  then enabling org channels — the ADR 0041 retrofit playbook.
- **Mock-mode realtime is offline.** Frontend-only mock mode (`@repo/api-mocks`)
  has no Centrifugo and no token endpoints, so the realtime client stays
  disconnected (the LIVE badge shows offline). Realtime is exercised by the
  real-stack smoke E2E instead.
- **drizzle-kit drift gate is table-level.** The CI migration gate applies the
  full chain to an empty Postgres and verifies table presence; a true
  column-level introspection diff waits on a stable `drizzle-kit/api` in the
  1.0 line (noted in `apps/api/test/migrations.itest.ts`).
- **Mobile device-gated items, inherited from the base:** NativeWind v5
  on-device smoke test (the exact-pin acceptance), Maestro/EAS E2E activation
  (needs a linked EAS project), native Sentry capture adapter
  (`@sentry/react-native` not installed), branded icon/splash art
  (placeholders wired). The mobile app stays dormant until a project needs
  it.
