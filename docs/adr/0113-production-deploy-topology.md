# ADR 0113 — Production deploy topology: Railway (EU) for the API, Vercel (`fra1`) for the web (ADR-D1)

**Status:** Accepted as design (2026-07-15). Finalizes ADR-D1 (drafted in the
vault "2026-07-11 Release plan — Perimetra" §ADR-D1) and resolves the host/region
fork (CAR-40) with the HQ ruling **Railway EU + Vercel `fra1`** — reversible (a
container-first design; the API is a standard Docker deployable that moves to any
container PaaS, and Vercel is swappable for any Next host). This ADR is the **R0
deploy-spine design**: it fixes the topology, the secrets/data-residency posture,
the release-phase migration, the CD + smoke shape, backups + the proven restore
drill, the observability baseline, the root-demo retirement, and FIL org
provisioning — the deep-pass §8.1 R0 tickets. **Execution is gated on Martin's
cloud accounts** (Railway + Vercel projects, secrets) and, for the container
build, Docker; see the STOP boundary. Builds on ADR 0031 (three deployables from
one build), ADR 0038 (migrations as a release phase), ADR 0104 (tier from
`VERCEL_TARGET_ENV`), ADR 0021 (observability), ADR 0026 (CSP), and ADR 0055 (org
provisioning).

## Context

"localhost is not v1." The FIL horizon needs a **deployed, https-reachable
instance** — the thesis cannot be validated on a laptop, and every incumbent the
research measured runs a hosted product. The rebuild has shipped the whole
configure → quote → order spine and gates green locally, but has **no production
deploy path at all**: the repo carries only `docker/compose.yaml` (dev infra),
one CI workflow (`ci.yml`), and **no Dockerfile, no platform config, no CD**. CAR-40
kept the host/region decision visible as an explicit Martin fork; it is now ruled.

The shape is fixed by what the API already is (ADR 0031): **one build, three
process entrypoints** — `main.ts` (HTTP), `worker.ts` (BullMQ queues), `migrate.ts`
(one-shot release-phase migrator). It needs Postgres + Redis, object storage
(MinIO/S3 for PII-free assets), and Centrifugo (realtime). The web is Next.js 16
(App Router, RSC) that proxies `/api/*` to the API same-origin. Data residency is
a first-order constraint: FIL is a CZ business handling customer PII under GDPR, so
**every stateful tier stays in the EU**.

## Decision

### 1. Topology — Railway (EU) for the API + stateful tiers, Vercel (`fra1`) for the web

- **API on Railway, EU region.** The three entrypoints deploy from ONE image
  (ADR 0031) as distinct Railway services sharing the build: `api-http`
  (`node dist/main.js`, the public service behind Railway's TLS + a custom
  domain), `api-worker` (`node dist/worker.js`, no ingress), and a **release-phase
  `api-migrate`** (`node dist/migrate.js`, run once per deploy BEFORE the http/worker
  services roll — never at app boot, ADR 0038). Railway-managed **Postgres** and
  **Redis** (EU); **object storage** is Railway's bucket or an EU S3 (MinIO-compatible,
  PII-free per the payloads-are-IDs-only rule); **Centrifugo** as a Railway service
  (the realtime adapter, ADR 0029) or deferred behind a flag for the first cut.
- **Web on Vercel, region `fra1` (Frankfurt, EU).** RSC/SSR runs in `fra1` so the
  same-origin `/api/*` proxy hop to Railway-EU stays intra-EU + low-latency. The
  `VERCEL_TARGET_ENV` tier gate (ADR 0104) already distinguishes preview from prod;
  prod carries `API_URL=https://<api-domain>` (the https guard of ADR 0104 is why a
  local build needs `SKIP_ENV_VALIDATION=1` — prod has the real https URL and needs
  no override).
- **Reversible (CAR-40 revertibility).** The API is a plain Docker image with no
  Railway-proprietary runtime coupling; moving to Fly/Render/a VPS is a config
  change, not a rewrite. Vercel is swappable for any Next host. The ruling is the
  cheapest correct v1 shape (managed EU Postgres/Redis + a container PaaS + a
  first-class Next host), not a lock-in.

### 2. Secrets, TLS, data residency

Secrets live in the platform secret stores (Railway variables, Vercel encrypted
env), NEVER in the repo — the env contract is a typed fail-fast schema per tier:
the **API server** vars (`DATABASE_URL`, `REDIS_URL`, `S3_*` object-storage,
`BETTER_AUTH_SECRET`, `CENTRIFUGO_*`, `SENTRY_DSN`) in
`apps/api/src/common/config/env.ts`, and the **web / mobile client** vars
(`NEXT_PUBLIC_*` / `EXPO_PUBLIC_*`, the realtime URL) in
`@repo/config/env/{web,mobile}` — each the source of truth for what its service
requires. TLS is platform-terminated (both the Railway and Vercel domains
auto-TLS); HSTS + the static security header set ship from `next.config.js` and
`proxy.ts` (ADR 0026). All stateful tiers are EU-region; Redis and the object store
are **non-PII-bearing by construction** (jobs/outbox carry IDs only, processors
re-fetch — the CLAUDE.md doctrine), so a Redis/bucket compromise leaks no personal
data.

### 3. Migrations as the release phase (ADR 0038, restated for the platform)

`api-migrate` runs `node dist/migrate.js` as a **release-phase one-shot** gated
BEFORE the http/worker services accept the new image — expand/contract + N−1
compatible + `lock_timeout` set, so a migration and the old code coexist safely
during the roll. Never at app boot (that would race replicas). This is exactly the
posture the O2-a numbering migration (ADR 0112) and any future DDL rely on.

### 4. CD + the deployed smoke test (merge gate honesty)

A GitHub Actions pipeline: on merge to `main`, build the API image + deploy the
three Railway services (migrate → http/worker), and trigger the Vercel prod
deploy. A **deployed smoke test** hits the live https instance post-deploy
(healthchecks green, a golden reproduce through the real stack, an auth round-trip)
and fails the deploy loudly on regression. **The merge gate does NOT assume hosted
green CI** until the pipeline itself is proven (deep-pass F3 / G-02): until then the
gate is local cold-clean + explicit authorization, never a silent "CI is green."
Railway has no native release-phase primitive that gates other services on a
run-to-completion job, so **the CD pipeline is the SOLE deploy trigger** (Railway's
own git auto-deploy disabled) and it — not the platform — enforces the
migrate → http/worker ordering.

### 5. Backups + a PROVEN restore drill

Railway-managed Postgres automated backups (daily + PITR where available), PLUS a
**documented, executed restore drill** — a backup is not a backup until a restore
has been proven end-to-end into a scratch database and the app verified against it.
The drill is a runbook step, re-run on each schema-shape change; "we have backups"
without a proven restore is the exact false-confidence R0 exists to kill.

### 6. Observability baseline

The ADR-0021 seam (Sentry + structured pino with querystring/PII redaction, the
golden-signals + OTEL loader) is wired for prod: `SENTRY_DSN` set per service, the
OTEL register loaded on the API, the CSP `connect-src` already allows the telemetry
origins (`proxy.ts`). The baseline is error capture + golden signals + redacted
request logs — enough to see the first prod incident, not a full observability
build.

### 7. Root-demo retirement

The web root (`/`) still serves the **fullstack-skeleton users demo** (a
`CreateUserForm` + `UsersList`/`UsersInfiniteList` off `jsonplaceholder`, under an
`h1` literally reading "Web"). A public deploy must not present a skeleton demo as
the product. `/` becomes a minimal branded Perimetra landing that routes into the
app (configurator) and to sign-in — retiring the demo components + their tests, the
demo's `home.goToUsers`/`accountLink` i18n keys and the placeholder title, the
`users` navigation route, and updating the Playwright `home.spec.ts`/`locale.spec.ts`
assertions (which pin the `"Web"` heading). This deliberately diverges from the
skeleton's `page.tsx` (a documented product divergence; the ADR-0104 tier gate that
mattered for security stays enforced at its BFF call site, `handle-api-request.ts`,
not the demo's home-prefetch call site). **Execution deferred to its own slice:**
it is a wider de-skeletoning that touches the `users` route + i18n + the
**Playwright e2e specs**, and those e2e specs cannot be run/verified without the
full app stack (Docker, down 2026-07-15) — so it lands with move (b) rather than as
a half-verifiable tail-end change; the decision (retire the demo) is fixed here.

### 8. FIL org provisioning

The first real tenant is provisioned through the shipped org path (ADR 0055/0057:
owner sign-up → auto-org → invite rep/workshop → `PLATFORM_ADMIN_EMAIL`
seed-promote → assign the release corpus). This is a runbook over existing
endpoints (post-CAR-26 onboarding), not new code — it lands when FIL's real data
(org name, legal profile, members) arrives.

### 9. The STOP boundary (what this ADR does NOT execute, and why)

The **cloud artifacts** — the API `Dockerfile` (multi-stage, the three entrypoints
off one build), the Railway service/topology config, the Vercel project config, the
CD workflow, and the smoke script — are **specified here and buildable, but not
committed untested this session**:

- Creating the Railway + Vercel **projects, services, secrets, and domains, and the
  actual deploy** require **Martin's cloud accounts** — they cannot be stood up or
  validated from this box. This is the CAR-40-adjacent account boundary.
- The `Dockerfile` build cannot be verified without **Docker** (down on the
  authoring box 2026-07-15); shipping an unbuilt Dockerfile as if it were proven is
  the false-confidence this ADR's own restore-drill principle rejects.

So R0 executes in two moves: (a) **now** — this topology design (the decision + the
executable spec), no code; (b) **once Martin's cloud accounts + Docker are
available** — the Dockerfile + platform config + CD + smoke + the first deploy +
backups restore drill + FIL provisioning + the root-demo retirement, each against a
real environment to validate rather than guess. The design here is the executable
spec for move (b).

## Consequences

- The FIL-reachable https instance — the thing "localhost is not v1" demands — is
  one Martin-accounts step away after this ADR; the design removes every
  in-repo unknown.
- Two platforms (Railway + Vercel) means two secret stores + two deploy triggers in
  CD — accepted for the first-class Next DX + managed EU stateful tiers; the
  container-first API keeps the Railway half swappable.
- Retiring the demo (in move b) will diverge `page.tsx` from the skeleton — future
  channel-A drains of that file will no longer apply cleanly (a deliberate,
  documented product divergence).
- Not shipping unbuilt cloud config avoids committing artifacts that would be
  validated for the first time in production; the cost is that R0 needs a second,
  account-holding session to finish.

## Alternatives rejected

- **A single all-in-one host (Fly/Render/a VPS with everything).** Loses Vercel's
  first-class Next DX + preview deploys and the managed EU Postgres/Redis
  operational simplicity; the container-first design keeps this option open as a
  fallback without committing to it now.
- **`compose.prod.yaml` on a self-managed VPS.** Maximal control, but v1 does not
  want to own patching, backups, and TLS renewal for one tenant — managed tiers buy
  those; the ADR-0038 release-phase migration works identically on either.
- **US region / a non-EU host.** Violates the GDPR data-residency constraint for CZ
  customer PII — a non-starter, not a trade-off.
- **Committing the Dockerfile + platform config now, untested.** Ships artifacts
  validated first in prod; deferred behind the Docker + accounts blockers rather
  than guessed.
- **Deploying at app boot instead of a release phase.** Races replicas (ADR 0038);
  the one-shot `api-migrate` service is the correct shape.

```

```
