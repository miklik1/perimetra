# fullstack-skeleton — Design (v2)

**Date:** 2026-06-10
**Status:** Awaiting review (v1 approved in dialogue; v2 integrates the deep-analysis findings — adversarial critique + stack-currency check + template survey)
**Base:** copy of the existing web-native frontend monorepo (Next.js 16 + Expo SDK 56 Turborepo, 13 `@repo/*` packages, ADRs 0001–0030)

## 1. Purpose & guiding principles

A TypeScript fullstack monorepo skeleton: the existing frontend plus a
production-grade NestJS backend. It is a **template that will seed ~10 client
projects over a ~10-year horizon**, built and operated by a small agency with
heavy AI-assisted development, for EU clients (GDPR applies).

Three principles drive every decision:

1. **Think 10 years out.** Prefer the structurally scalable option over the
   minimal starter — "starting small is no longer leverage." Complexity that
   buys scale is accepted; complexity whose cost is *operational* and paid at
   runtime on every derived project (day-one microservices) is rejected.
2. **Conventions are the product.** Anything the skeleton leaves open, ten
   derived projects will re-decide ten different ways. The skeleton's job is to
   decide once: transactions, pagination, migrations, retention, tenancy
   scoping, error shapes, redaction. Tech choices fill one ADR each;
   conventions fill the rest.
3. **The wrong thing should be uncompilable, not discouraged.** With AI agents
   writing most code, enforcement beats documentation: ESLint boundaries that
   reach the data layer, transaction APIs that can't be bypassed, generators
   that make the canonical pattern the path of least resistance.

**Success criteria:**

- `docker compose up` + `pnpm dev` gives a working fullstack app: signup/login
  (Better Auth), an authenticated org-scoped example resource (DB-backed CRUD),
  a background job, a realtime event reaching the browser, a file upload, and a
  locale-aware transactional email visible in Mailpit.
- The api and worker images are stateless and horizontally scalable on any
  container platform, with health probes, graceful shutdown, and a
  zero-downtime deploy story (including migrations).
- A new project can be stamped out with one command, and skeleton fixes can
  flow to derived projects through a documented mechanism.
- GDPR export/erasure works end-to-end across every store the skeleton adds.
- The full quality bar stays green: `lint`, `check-types`, `test`, `build`,
  boundaries enforced, real-stack smoke E2E in CI, supply-chain gates on.
- Every decision below is an ADR (0031+), continuing the existing ADR culture.

## 2. Stack (locked, versions verified 2026-06)

| Area | Decision | Notes |
| --- | --- | --- |
| Runtime | **Node 24 LTS**, pnpm 11, Turborepo 2.x, Vitest 4 | Node 22 is in maintenance; base repo's `.nvmrc`/catalogs get bumped |
| Backend | **NestJS 11 on Fastify 5**, ESM-ready build (NodeNext) | NestJS 12 (~Q3 2026) is a full-ESM migration with native zod validation — being ESM-ready now makes that jump cheap |
| DB / ORM | **PostgreSQL 17 + Drizzle `1.0.0-rc.x`** (pinned) | Starting on 0.45.x buys an immediate RQB v1→v2 migration; queries isolated behind repositories regardless. Driver: node-postgres `Pool` (postgres.js prepared statements break behind transaction-mode poolers) |
| Auth | **Better Auth** (pinned exact; advisories watched) | Handler mounted **manually on Fastify** — the community NestJS lib's Fastify support is beta; manual mount is a plain request handler, full control. Had a critical CVE 2025-61928 (API-key plugin) — version pinning + advisory subscription is policy, api-key plugin off until needed |
| Contract | Shared zod (v4) in `@repo/validators` via nestjs-zod v5; OpenAPI 3.1 generated from the same schemas | DTO creation centralized so NestJS 12's native Standard Schema validation can replace the pipe later |
| Infra | Redis 7 (cache/queues/throttle), BullMQ (+ first-party `bullmq-otel`), Centrifugo **≥6.8.1** (JWKS security fix), MinIO/S3, SMTP seam | |
| Observability | pino + OpenTelemetry (**`@fastify/otel`** — the OTel-contrib Fastify instrumentation is deprecated/removed) + Sentry + PostHog | |
| Deploy | Containers, platform-agnostic; multi-stage Dockerfiles; docker-compose dev | No k8s manifests in the skeleton |
| IDs / versioning | UUIDv7 PKs; URI versioning `/v1` | UUIDv7 also gives keyset pagination and outbox ordering for free |
| Tests | Vitest 4 + Testcontainers (api), Playwright (web), Jest (mobile only) | |

## 3. Repo layout (delta over the copied base)

```
apps/
  api/                      NestJS 11 (Fastify) — modular monolith
    src/main.ts             HTTP entrypoint
    src/worker.ts           BullMQ worker entrypoint (separate Nest app context)
    src/migrate.ts          one-shot migration entrypoint (deploy release phase)
    src/modules/            domain + infra modules (§7)
    src/common/             config, filters, interceptors, guards, otel, logging
packages/
  db/                       @repo/db — Drizzle schema split PER MODULE
    src/schema/<module>/    each module's tables, exported as @repo/db/schema/<module>
    src/columns.ts          shared column helpers: id (uuidv7), timestamps(), softDelete(), pii()
    src/factories/          typed test/seed factories (makeUser(overrides), …)
    migrations/             plain SQL, expand/contract discipline (§6)
  validators/               + API contract schemas + shared envelope helpers
                            (paginated(schema), filter/sort grammar)
  auth/                     REFACTORED — wraps the Better Auth client; public
                            surface (useAuth, AuthGuard, provider) preserved
  api/                      client points at the real backend via the proxy;
                            custom 401-refresh machinery removed
  flags/                    registry becomes the shared FE+BE flag-key source of
                            truth (with per-flag consent annotations, §10)
  ai/                       @repo/ai — thin LLM seam (§7.6)
docker/                     compose (postgres, redis, centrifugo, minio, mailpit;
                            optional pgbouncer profile) + Dockerfiles + configs
scripts/create-project/     stamp-out-a-new-project init script (§4)
docs/adr/                   0031+ (§14)
docs/operations/            runbooks: backup/restore, deploy recipes, DR (§13)
CLAUDE.md / AGENTS.md       agent navigation conventions (§12)
```

## 4. Template lifecycle — stamping out and updating projects

The spec's mission is ten derived repos over ten years; the lifecycle is a
first-class design concern, not an afterthought.

- **Stamp-out:** `pnpm create-project` script — renames the workspace scope,
  generates all secrets (auth, Centrifugo HMAC, S3), resets the ADR log to
  "inherited 0001–00NN from skeleton@<version>", writes a `skeleton` field in
  the root `package.json` recording the base commit, re-creates git history
  with a provenance note, and prints the post-clone checklist.
- **Update propagation, two channels:**
  1. **Versioned packages (primary).** Maximal skeleton-owned logic lives in
     `@repo/*` packages. The skeleton publishes them to a private registry
     (GitHub Packages); derived projects consume by version, so most fixes
     propagate as `pnpm up`. The monorepo keeps workspace-linking for skeleton
     development itself.
  2. **Upstream merge (glue).** App-level glue (compose files, CI, Dockerfiles,
     app shells) propagates via a documented `git remote add skeleton` +
     cherry-pick/merge cadence, Epic-Stack-style, tracked against the recorded
     base commit.
- **Shared Renovate preset** published from this repo
  (`extends: ["github>martin-miklik/fullstack-skeleton//renovate"]`) — one
  place to steer dependency policy for every derived project. Node LTS upgrade
  cadence documented.

## 5. Backend architecture

**Modular monolith, two deployables** (`main.ts` HTTP, `worker.ts` queue
consumer, plus the `migrate.ts` one-shot). Both stateless; all shared state in
Postgres/Redis. Day-one microservices rejected: their cost is operational,
paid at runtime on every derived project forever.

**Transactions (the load-bearing pattern).** Ambient transaction propagation
via `@nestjs-cls/transactional` + its Drizzle adapter: services declare
`@Transactional()`, repositories and the outbox writer resolve the ambient
`tx` from CLS. `OutboxService.emit()` *only* accepts the ambient transactional
client — emitting an event outside a transaction does not compile. The example
resource demonstrates the full pattern.

**Transactional outbox (specified, not hand-waved):**

- Events written to the `outbox` table in the same `@Transactional()` scope as
  the state change.
- Relay (in the worker): polled batches via `SELECT … FOR UPDATE SKIP LOCKED`,
  ordered by UUIDv7 id — safe across N worker replicas, no double-publish.
  LISTEN/NOTIFY deliberately rejected: marginal latency win over a 500ms poll,
  and it breaks behind transaction-mode PgBouncer.
- `published_at` column + scheduled cleanup job (retention §13); max-attempts
  with dead-letter status for poison rows.
- Consumer idempotency: BullMQ `jobId = eventId` dedup; consumers treat
  delivery as at-least-once.
- Rows carry `traceparent` so job/event traces link to the originating request.
- Per-aggregate ordering limits documented (FIFO only per relay batch).

**Module boundaries that reach the data layer.** "Modules own their tables" is
enforced, not folklore: `@repo/db` schema is split per module with
entry-point-per-module exports, and ESLint `boundaries` rules map
`apps/api/src/modules/X/**` → may import only `@repo/db/schema/X` (plus
shared column helpers). Cross-module reads go through the owning module's
exported query service, or an explicit read-model module (CQRS-lite) — never
joins across module schemas. This is what keeps every module *extractable*
into a service later, which is the entire justification for the monolith.

**Domain-layer position (stated once, so it isn't relitigated per project):**
transaction-script services are fine; extract a repository when a query is
reused; no mandatory DDD ceremony. The generator (§12) scaffolds
contract → controller → service → repository → schema → events → jobs → tests.

**Error handling:** global exception filter emits the error envelope the
frontend `ApiError` parses (status taxonomy, machine-readable `code`, zod
field errors → 422). Exceptions at the seam; no Result idiom.

## 6. Data layer conventions

- **Zero-downtime migrations.** Migrations run as a one-shot container
  (`migrate.ts`) *before* rollout — the platform-agnostic release phase; never
  at app boot (N-replica race). **Expand/contract is mandatory:** every
  migration must be compatible with N−1 code (add-nullable → backfill →
  enforce; never rename in one step). Migration template sets
  `lock_timeout = '5s'`; `CREATE INDEX CONCURRENTLY` for non-trivial tables.
  CI gate runs the full chain from an empty Testcontainers Postgres and diffs
  against `drizzle-kit` introspection (drift gate).
- **Connection pooling.** Small per-instance pools (start `max: 10`); the
  `pool_size × replicas < max_connections` math documented in
  `ARCHITECTURE.md`; optional `pgbouncer` compose profile. Code rule:
  **transaction-pooling-safe by default** — no session GUCs, no LISTEN/NOTIFY,
  no prepared-statement reliance.
- **Column conventions** in `@repo/db/columns`: `id` (UUIDv7), `timestamps()`,
  `softDelete()` (with the partial-unique-index pattern documented and the
  rule that soft-deleted PII is still PII for erasure purposes), and `pii()` —
  a column wrapper registering the field in the PII registry that drives
  export/erasure and redaction (§11).
- **Tenancy seam (reversing v1's out-of-scope call).** Multi-tenancy is not
  built, but the seam exists from day one: the example resource carries an
  `organizationId` FK; queries go through a CLS-carried org-scoped repository
  pattern; Better Auth `organization` plugin tables are generated but dormant;
  a one-page retrofit playbook ADR. Retrofitting `organization_id` across
  every table/query/cache key is the most expensive retrofit in B2B software —
  the seam costs hours, the retrofit weeks per project.
- **Read-replica seam:** the `@repo/db` client factory accepts
  primary/replica URLs (Drizzle `withReplicas`), both defaulting to one DSN;
  replica-lag caveat for read-your-writes documented.
- **Seeds & factories:** `pnpm db:seed` (idempotent, env-guarded, includes the
  demo dataset) built on typed factories in `@repo/db/factories`, reused by
  Testcontainers tests — and by AI agents writing integration tests.

## 7. Modules

### 7.1 Auth (Better Auth)

Better Auth mounted manually on Fastify (§2), Drizzle adapter (tables in
`@repo/db/schema/auth`), Redis secondary storage for session lookups,
email/password + verification + reset through the email module, Expo plugin
for mobile. Sessions are httpOnly cookies, same-origin via the web proxy (§9):
`__Host-` prefix, `Secure`, `SameSite=Lax`; strict throttle tiers on
`/auth/*`. **Admin plugin on** for the minimal admin surface: user
ban/unban and impersonation (every client eventually asks for "log in as the
user"), exposed through a guarded route group — no admin UI app in the
skeleton. Frontend `@repo/auth` becomes a Better Auth client wrapper; public
surface (`useAuth`, `AuthGuard`, provider) preserved; custom JWT/refresh
machinery deleted.

### 7.2 Jobs & scheduling

BullMQ queues declared per domain module, consumed by the worker. **BullMQ
repeatable jobs are the only cron mechanism — `@nestjs/schedule` is banned**
(in-process cron fires once per replica). Failed jobs: DLQ convention
(`failed → DLQ queue + Sentry event + metric`) with a documented replay
procedure. **bull-board** mounted behind admin auth in non-prod. Singleton
work uses BullMQ job-id dedup or pg advisory locks (named primitive). **Job
payloads carry IDs, never PII** — processors re-fetch; this single rule makes
Redis non-PII-bearing and rebuildable.

### 7.3 Realtime (Centrifugo)

NestJS issues connection/subscription JWTs and publishes via the Centrifugo
HTTP API (≥6.8.1). Frontend Centrifuge adapter gets a real token endpoint.
Channel-naming and authorization conventions documented (per-user and per-org
channels).

### 7.4 Email (+ backend i18n)

Provider-agnostic `EmailSender` seam + nodemailer/SMTP adapter; Mailpit in
compose; react-email templates. **Locale-aware from day one:** users carry a
`locale`; the worker renders templates through the shared ICU catalogs
(`@repo/i18n`), so transactional email arrives in the user's language — EU
table stakes that touches the user model, worker, and email seam, hence
designed in rather than bolted on.

### 7.5 Storage (S3)

Presigned upload/download (AWS SDK v3); MinIO in compose. Hygiene specified:
content-type/size constraints on the presign request, orphaned-object
lifecycle rule (cleanup job for presigned-but-never-confirmed uploads), S3
versioning + lifecycle defaults, and an AV-scanning seam (job on
upload-complete event; adapter optional).

### 7.6 Thin seams (survey-validated; built as seams, not features)

- **API keys:** Better Auth `apiKey` plugin (off by default, see CVE policy)
  behind a documented scopes + per-key throttle-tier design.
- **Outbound webhooks:** endpoint registry, HMAC signing, retries with
  backoff, delivery log — a thin module over the outbox + BullMQ, which is
  already 80% of the machinery.
- **Billing:** provider-agnostic `customer / subscription / entitlement`
  interface + webhook-to-outbox ingestion pattern; no provider wired, no
  billing UI. EU note: merchant-of-record providers (Polar/Paddle/Lemon
  Squeezy) documented as the VAT-sane default.
- **AI (`@repo/ai`):** thin wrapper over the Vercel AI SDK (provider/gateway
  config injected), streaming over the existing API, and a pgvector +
  Drizzle embeddings convention. No chatbot UI — that's demo-ware.

### 7.7 Privacy & audit (GDPR plumbing — see §11)

`privacy` module: `exportUser(userId)` (Art. 20) and `eraseUser(userId)`
(Art. 17) BullMQ jobs that fan out via a `PrivacyHandler` interface each
domain module registers — driven by the `pii()` registry, covering Better Auth
tables, S3 objects, Sentry, PostHog person profiles, and Centrifugo history.
`audit` module: append-only audit table (actor, action, entity, before/after
diff, request-id) — GDPR Art. 30 + client security questionnaires —
demonstrated by the example resource.

### 7.8 Reference resource

One example domain module exercising EVERYTHING: zod contract →
controller → `@Transactional()` service → org-scoped repository →
per-module schema → outbox event → job → realtime push → audit entry →
privacy handler → factories → unit + integration + smoke tests. This is the
module the generator (§12) reproduces and the pattern AI agents copy.

## 8. API conventions

- **Pagination:** cursor/keyset by default (UUIDv7 makes it trivial); shared
  `paginated(schema)` zod envelope; offset only as documented exception.
- **Filtering/sorting:** one constrained query-param grammar in
  `@repo/validators`, not per-endpoint invention.
- **Idempotency:** `Idempotency-Key` header support for unsafe methods via a
  Redis-backed interceptor (returns the cached response on replay).
- **Response serialization is mandatory:** every endpoint returns through a
  zod response schema with strip semantics — an unvalidated Drizzle `select()`
  shipping `passwordHash` is the leak class this kills. Doubles as the OpenAPI
  response contract.
- **OpenAPI 3.1** generated from the zod schemas every build + snapshot test
  (contract-drift gate). SDK generation for external consumers documented as a
  later step (Speakeasy/hey-api over the same document).

## 9. Web ↔ API topology

- Browser → Next.js rewrite proxy `/api/*` → API service (same-origin, httpOnly
  cookies work, no CORS). Fastify `trustProxy` configured — throttling keys on
  real client IPs.
- RSC → direct server-to-server fetch (pluggable terminal fetch seam),
  forwarding cookies.
- Mobile → direct API URL; Better Auth Expo plugin.
- Mock mode (`@repo/api-mocks` + MSW) unchanged for frontend-only dev; MSW is
  also the named convention for mocking *third-party* HTTP in tests.

## 10. Analytics & flags (PostHog)

Frontend wiring carries over (typed flag registry + analytics seam, web +
mobile, shared client, no-op defaults, auth identity bridge). Backend adds:

- `posthog-node` module: server-side capture for events the client can't be
  trusted with (domain events, job outcomes) + server-side flag evaluation via
  the **`evaluateFlags()` snapshot API** (the deprecated per-flag calls are
  avoided). Local-eval definitions are polled per process — modest polling
  interval; no remote-config payloads on hot paths.
- **One typed flag registry** (`@repo/flags`) across React, RSC, NestJS, and
  workers; flags carry a **consent annotation** so client-side initialization
  is consent-gated (GDPR) while anonymous server-side flags still work.
- Ingestion reverse-proxy via Next rewrite; **EU Cloud** hosts as the default
  in env examples.
- Sentry + PostHog + OTel stay three non-overlapping layers: what users do /
  what broke / why it's slow.

## 11. Observability & data protection

- **Logs:** nestjs-pino; request-id and `trace_id`/`span_id` injected (pino
  mixin + `@opentelemetry/instrumentation-pino`). **Redaction by default:**
  pino `redact` paths (cookies, authorization, password fields, PII-registry
  fields), Sentry `beforeSend` scrubber + `sendDefaultPii: false`, PostHog
  property allowlist. Logs ship via pino → collector (OTel logs signal still
  immature).
- **Traces:** OTel NodeSDK + `@fastify/otel` + nestjs-core + pg + ioredis +
  first-party `bullmq-otel`; context propagates through outbox rows and job
  payloads (`traceparent`).
- **Metrics (the v1 gap):** OTel Metrics through the same OTLP seam; explicit
  instruments for RED rates/latency, BullMQ queue depth/age, outbox lag, pg
  pool saturation. `OBSERVABILITY.md` names the golden signals and where
  alerts attach (vendor-neutral: "alert on these series"). Queue depth and
  outbox lag are precisely the health signals of this architecture's own async
  machinery.
- **Retention:** log/audit/outbox retention defaults executed by scheduled
  jobs (outbox 30d, audit 2y, configurable).

## 12. AI-agent & developer DX

- Root `CLAUDE.md` + `AGENTS.md` (boundary rules, canonical patterns, ADR
  index pointer); per-module `CONTEXT.md` stubs.
- **`turbo gen module`** scaffolds the full §7.8 pattern (the 9-file dance an
  agent gets 80% right unaided — the generator makes 100% the default); the
  existing package/route generators carry over.
- One-command local bootstrap: `pnpm setup` (compose up, migrate, seed, env
  files from examples).
- Devcontainer definition (optional but cheap; pairs with cloud agents).

## 13. Operations & security baseline

- **Deploy:** one image, three commands (api / worker / migrate). Order:
  migrate → roll api/worker. Rollback = previous image (schema stays N−1
  compatible by §6 doctrine). 1–2 blessed recipes documented (a managed-PaaS
  path and a Hetzner/Coolify-style self-hosted path), including where
  Centrifugo/Redis/worker land. Preview-env recipe: ephemeral compose per PR
  with migrate + seed.
- **Backups/DR** (`docs/operations/`): managed-Postgres PITR preferred, else
  pgBackRest convention; S3 versioning/lifecycle; **"Redis is ephemeral —
  anything durable goes through the outbox"** doctrine (made true by the
  IDs-not-PII job rule); restore drill checklist; stated RPO/RTO defaults.
- **Security:** `@fastify/helmet`, 1MB default body limit, `__Host-` cookies,
  documented CSRF stance (Better Auth origin-check on its routes; `/v1`
  mutations rely on SameSite + same-origin proxy — with an integration test
  proving cross-origin mutation fails), throttle tiers (anon / user / api-key),
  secrets via env only (12-factor; no secrets-manager lock-in, seam
  documented). OWASP ASVS L2 mapped once with conscious exclusions noted in
  `SECURITY.md`.
- **Supply chain (CI):** gitleaks (CI + pre-commit), Trivy scan of built
  images, `pnpm audit --prod` gate, Renovate preset (§4), pnpm 11's
  `minimumReleaseAge` supply-chain delay left on.
- **Load testing:** one k6 script against the reference resource
  (`pnpm loadtest` vs compose), baseline numbers recorded — the only way
  pool-sizing and "Fastify 2×" claims get verified per project.

## 14. Testing & CI

- **Vitest 4** for `apps/api` (shared vitest-config; Jest stays mobile-only).
- **Unit** (services/guards/filters) + **integration** via Testcontainers
  (real Postgres + Redis): repositories, auth flows, outbox relay concurrency
  (two relays, no double-publish), idempotency interceptor, privacy
  export/erasure, the reference resource at the HTTP layer.
- **Migration gates:** full chain from empty DB + drizzle-kit drift diff.
- **Real-stack smoke E2E (the v1 gap):** one CI job composes the real stack
  and runs a small Playwright `@smoke` project — signup → login → CRUD →
  realtime event → upload → email-in-Mailpit — proving the riskiest glue
  (proxy ↔ cookies ↔ Better Auth ↔ RSC fetch ↔ CSRF) actually works. The broad
  Playwright suite stays mock-mode.
- **Contract:** OpenAPI snapshot test.
- CI: existing workflow + api graph + docker build + supply-chain gates (§13).

## 15. ADRs to write (0031+)

Tech: (1) NestJS/Fastify, modular monolith + worker split; (2) Postgres +
Drizzle, `@repo/db` per-module schema + boundary enforcement; (3) Better Auth
(manual Fastify mount; supersedes the client machinery of 0016/0017);
(4) shared-zod contract + generated OpenAPI (amends 0007/0019); (5) infra
modules (Redis/BullMQ, Centrifugo — closes 0029, S3, email); (6) backend
observability (pino+OTel+Sentry, PostHog server-side; amends 0021/0028).

Conventions: (7) transactions + outbox mechanics; (8) zero-downtime migration
doctrine + pooling; (9) API semantics (pagination/idempotency/serialization);
(10) GDPR plumbing (PII registry, privacy module, audit, retention, redaction);
(11) tenancy seam + scoped repositories; (12) template lifecycle (stamp-out +
update propagation); (13) jobs & scheduling rules (repeatables-only cron, DLQ);
(14) security baseline + supply chain.

## 16. Out of scope (deliberately)

- k8s manifests/Helm (container images are the contract).
- *Full* multi-tenancy, billing, admin UI, webhooks portal — the **seams**
  exist (§6, §7.6), the features don't.
- Microservices/NestJS transports (§5), chatbot UIs, landing-page/marketing
  machinery, docs-site app, vendor-coupled services (Clerk/Arcjet-style).
- Device-gated mobile leftovers (NativeWind smoke test, EAS E2E, native
  Sentry) — unchanged backlog from the base.

## 17. Build order

1. **Re-baseline:** copy base, rename, fresh history + provenance, bump Node
   24 / pnpm 11 / Vitest 4 catalogs, ESM-ready tsconfig, CI green.
2. **Foundations first:** `docker/` compose; `@repo/db` (per-module schema
   layout, column helpers incl. `pii()`, factories, migration template);
   `apps/api` shell (Fastify, config, health, pino+redaction, versioning,
   exception filter, CLS + `@Transactional()` wiring); `migrate.ts` +
   migration CI gates; Dockerfiles.
3. **Auth:** Better Auth manual mount + Redis storage + `@repo/auth` refactor +
   proxy topology + security baseline (helmet, cookies, throttle tiers, CSRF
   test).
4. **Async core:** outbox (emit API + SKIP LOCKED relay + cleanup + DLQ) +
   jobs module (repeatables, bull-board) + email (+ locale rendering) +
   storage + realtime.
5. **Conventions made concrete:** API semantics helpers (pagination,
   idempotency, serialization), audit + privacy modules, tenancy-seam
   repositories — all landed via the **reference resource** + `turbo gen
   module`.
6. **Observability + analytics:** OTel traces/metrics, Sentry, PostHog
   server-side + shared registry + consent annotations; OBSERVABILITY.md.
7. **Quality net:** Testcontainers suite, real-stack smoke E2E, OpenAPI
   snapshot, k6 baseline, supply-chain CI gates.
8. **Template lifecycle:** create-project script, package publishing setup,
   Renovate preset, upstream-merge docs; CLAUDE.md/AGENTS.md; ops runbooks;
   ADRs 0031+; ARCHITECTURE.md rewrite. Thin seams (webhooks, billing, ai,
   api-keys) land here, after the patterns they build on are proven.
