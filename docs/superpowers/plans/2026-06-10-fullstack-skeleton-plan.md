# fullstack-skeleton — Implementation plan

Executes the approved spec
(`docs/superpowers/specs/2026-06-10-fullstack-skeleton-design.md`). Phases are
ordered so foundations land before anything that depends on them; each phase
ends with the full quality bar green (`lint`, `check-types`, `test`, `build`)
and a commit. ADRs are written in the phase where their subject lands.

## Phase 1 — Re-baseline (copy + identity + runtime bumps)

1. Copy the base monorepo content into this repo (exclude `.git`,
   `node_modules`, `.turbo`, caches, build output); keep this repo's existing
   `docs/superpowers/` content alongside the base's docs.
2. Identity: root package name → `fullstack-skeleton`; README rewritten
   (fullstack scope, provenance note: copied from the web-native base at
   <commit> on 2026-06-10, evolves independently).
3. Runtime bumps: Node 24 LTS (`.nvmrc`, engines, CI), pnpm 11
   (`packageManager`, fresh lockfile), ESM-ready tsconfig posture for the
   future api app (NodeNext where applicable).
4. Verify: clean `pnpm install`, then full suite green. Commit per logical
   step (copy / identity / bumps).

Exit: green monorepo named fullstack-skeleton on Node 24 + pnpm 11, pushed.

## Phase 2 — Foundations: docker, @repo/db, api shell

1. `docker/`: compose with postgres 17, redis 7, centrifugo (≥6.8.1), minio,
   mailpit; optional `pgbouncer` profile; healthchecks; `.env` conventions.
2. `@repo/db`: drizzle `1.0.0-rc.x` pinned; per-module schema layout with
   per-module package exports; column helpers (`id` UUIDv7, `timestamps()`,
   `softDelete()`, `pii()` registry); node-postgres pool factory (small pool,
   `withReplicas` seam); drizzle-kit config; migration template
   (`lock_timeout`); factories dir; `db:generate`/`db:migrate`/`db:seed`
   scripts.
3. `apps/api` shell: NestJS 11 + Fastify 5; config module (zod-validated env,
   fail-fast); nestjs-pino with redaction defaults; global exception filter
   (ApiError-compatible envelope); `/v1` URI versioning; `@fastify/helmet`;
   body limit; `trustProxy`; terminus health module (`/health/live`,
   `/health/ready`); graceful shutdown; CLS + `@nestjs-cls/transactional`
   (Drizzle adapter) wired; `main.ts` + `worker.ts` + `migrate.ts`
   entrypoints; Vitest 4 via shared vitest-config.
4. Dockerfiles: turbo prune → pnpm deploy → slim Node 24 runtime; one image,
   three commands.
5. ESLint boundaries extended: `modules/X` ↔ `@repo/db/schema/X` rule.
6. CI: api graph joins lint/types/test/build; migration-from-scratch +
   drizzle-kit drift gate on Testcontainers.
7. ADRs: 0031 (NestJS/Fastify, monolith + worker), 0032 (Postgres + Drizzle,
   per-module schema + boundaries), 0038 (zero-downtime migrations + pooling).

## Phase 3 — Auth

1. Better Auth (pinned) mounted manually on Fastify; Drizzle adapter (schema
   under `@repo/db/schema/auth`); Redis secondary storage; email/password +
   verification + reset (email module stub until Phase 4 — Mailpit direct);
   admin plugin (ban/impersonate) behind guard; org plugin tables generated,
   dormant; `__Host-` cookies; throttle tiers on `/auth/*`.
2. Web topology: Next rewrites `/api/*` → api; RSC server-to-server fetch;
   CSRF integration test (cross-origin mutation fails).
3. `@repo/auth` refactor: Better Auth client wrapper; keep `useAuth`,
   `AuthGuard`, provider surface; delete token-manager/refresh middleware;
   web app login flow on the new client; Expo plugin wired (dormant app).
4. ADR: 0033 (Better Auth; supersedes 0016/0017 client machinery, amends 0018).

## Phase 4 — Async core: outbox, jobs, email, storage, realtime

1. Outbox: table + `OutboxService.emit()` (ambient tx only); relay in worker
   (`FOR UPDATE SKIP LOCKED` batches, ordered by id, `published_at`,
   max-attempts → dead-letter status, `traceparent` column); cleanup
   repeatable job; relay concurrency test (two relays, no double-publish).
2. Jobs: BullMQ module conventions; repeatables-only cron (no
   `@nestjs/schedule` — lint-banned import); DLQ + replay doc; bull-board
   behind admin auth (non-prod); job payloads IDs-only rule documented +
   reviewed in the reference resource.
3. Email: `EmailSender` seam + SMTP adapter; react-email; locale-aware
   rendering via shared ICU catalogs; Better Auth mails switched onto it.
4. Storage: presign module (type/size constraints), orphan-cleanup job,
   AV-scan seam.
5. Realtime: Centrifugo token endpoint + publish service; channel conventions
   (user/org); frontend adapter wired against it.
6. ADRs: 0035 (infra modules; closes 0029), 0037 (transactions + outbox),
   0043 (jobs & scheduling rules).

## Phase 5 — Conventions made concrete (reference resource)

1. API semantics helpers in `@repo/validators`: `paginated(schema)`,
   filter/sort grammar; Redis idempotency interceptor; mandatory zod response
   serialization wiring.
2. Audit module (append-only, request-id linked) + privacy module
   (`exportUser`/`eraseUser` jobs over `PrivacyHandler` registry, PostHog +
   Sentry + S3 hooks); retention scheduled jobs (outbox 30d, audit 2y).
3. Tenancy seam: CLS org context + org-scoped repository pattern.
4. **Reference resource** exercising the entire §7.8 chain, org-scoped, with
   factories, unit + integration tests.
5. `turbo gen module` generator reproducing the reference pattern.
6. Frontend: example screens consume the resource (list with cursor
   pagination, create with idempotency, realtime update).
7. ADRs: 0039 (API semantics), 0040 (GDPR plumbing), 0041 (tenancy seam).

## Phase 6 — Observability & analytics

1. OTel: NodeSDK boot (`--import` preload), `@fastify/otel`, nestjs-core, pg,
   ioredis, `bullmq-otel`; pino trace-id mixin; traceparent restore in
   workers/outbox consumers.
2. Metrics: RED + queue depth/age + outbox lag + pool saturation;
   `OBSERVABILITY.md` (golden signals, alert attach points).
3. Sentry (api + worker), scrubber tied to PII registry.
4. PostHog backend: `posthog-node` module, `evaluateFlags()` snapshot API,
   shared `@repo/flags` registry + consent annotations; ingestion
   reverse-proxy rewrite; EU Cloud defaults.
5. ADR: 0036 (backend observability + server-side PostHog; amends 0021/0028).

## Phase 7 — Quality net

1. Testcontainers suite completed (auth flows, idempotency, privacy
   export/erasure, migration gates already in CI from Phase 2).
2. Real-stack smoke E2E: compose-up CI job + Playwright `@smoke` (signup →
   login → CRUD → realtime → upload → email in Mailpit); broad suite stays
   mock-mode.
3. OpenAPI 3.1 generation from zod + snapshot test.
4. k6 baseline script (`pnpm loadtest`) + recorded numbers.
5. Supply-chain gates: gitleaks (CI + lefthook), `pnpm audit --prod`, Trivy on
   built images.
6. ADR: 0044 (security baseline + supply chain; `SECURITY.md` with ASVS L2
   mapping).

## Phase 8 — Template lifecycle & docs

1. `scripts/create-project`: scope rename, secret generation, ADR-log reset,
   `skeleton` base-commit field, checklist.
2. Package publishing setup (GitHub Packages) for skeleton-owned `@repo/*`;
   publishable Renovate preset; `docs/managing-updates.md`.
3. Thin seams: webhooks module (registry/HMAC/retries/delivery log over
   outbox), billing seam interface + webhook-to-outbox recipe, `@repo/ai`
   (AI SDK wrapper + pgvector convention), api-key design doc (plugin off).
4. `CLAUDE.md`/`AGENTS.md` + per-module `CONTEXT.md`; `pnpm setup` bootstrap;
   devcontainer; ops runbooks (`docs/operations/`: backup/restore, deploy
   recipes, DR, preview envs).
5. ARCHITECTURE.md full rewrite (fullstack); remaining ADRs (0034 contract,
   0042 template lifecycle); final sweep: knip, boundaries, clean-install
   green.

## Working rules

- Commit per coherent step; push at phase ends. Conventional-ish messages.
- Any deviation from the spec discovered mid-build → note in the commit and,
  if architectural, amend the spec + ADR rather than silently diverging.
- Versions get pinned exactly where the spec says pinned (drizzle rc, better-auth,
  nativewind already-exact); everything else follows catalogs.

---

## STATUS: shipped (2026-06-11)

All eight phases landed; the full quality bar (turbo check-types / lint /
test / build, knip, `pnpm --filter api test:integration`) is green at the
final integration commit. Deviations from this plan, recorded as decided:

- Phase 8 item 2: GitHub Packages publishing of `@repo/*` was deliberately
  DEFERRED — the upstream-merge channel + shared Renovate preset are the two
  shipped update channels (`docs/managing-updates.md`, ADR 0042).
- Phase 8 item 3: webhooks/billing shipped as thin SEAMS (dispatcher +
  provider interface, recipes in module READMEs) rather than full
  registry/delivery-log features; `@repo/ai` ships interfaces + router +
  no-op models WITHOUT the AI SDK dependency (ADR 0034).
- `pnpm setup` is invoked as `pnpm run setup` (pnpm's builtin `setup`
  shadows the bare form).

Derived projects start at ADR 0045 via `pnpm create-project` (ADR 0042).
