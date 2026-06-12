# fullstack-skeleton

TypeScript fullstack monorepo skeleton: a **NestJS 11 (Fastify) backend**, a
**Next.js 16 web app**, and an **Expo SDK 56 React Native app** that share
logic, types, and design tokens — not rendered UI. Built as a template for
client projects with scalability as the structural priority: stateless
containers, a modular monolith with an api/worker split, strict
ESLint-enforced module boundaries, and a transactional outbox.

> **Provenance:** the frontend half was imported from the author's
> web+native skeleton (base commit `29667e7`, 2026-06-10) and evolves
> independently here. ADRs 0001–0030 are inherited from that base; backend
> decisions start at ADR 0031.

## Design documents

- **Spec:** [`docs/superpowers/specs/2026-06-10-fullstack-skeleton-design.md`](docs/superpowers/specs/2026-06-10-fullstack-skeleton-design.md)
- **Plan:** [`docs/superpowers/plans/2026-06-10-fullstack-skeleton-plan.md`](docs/superpowers/plans/2026-06-10-fullstack-skeleton-plan.md)
- **Architecture:** [ARCHITECTURE.md](./ARCHITECTURE.md) · ADRs in
  [`docs/adr/`](docs/adr/README.md)
- **Operations:** runbooks in [`docs/operations/`](docs/operations/)
  (backup/restore, deploy, incident) ·
  [OBSERVABILITY.md](./OBSERVABILITY.md) · [SECURITY.md](./SECURITY.md)
- **Workflow:** [CONTRIBUTING.md](./CONTRIBUTING.md) · template lifecycle in
  [`docs/managing-updates.md`](docs/managing-updates.md)

## Layout

```
apps/
  api/        NestJS 11 (Fastify) — modular monolith; api + worker + migrate entrypoints
  web/        Next.js 16 (App Router, RSC, Turbopack)
  mobile/     Expo SDK 56 (RN 0.85, expo-router) — dormant
packages/                # @repo/* — shared logic/types, never rendered UI
  db/         Drizzle schema (per-module) + migrations — importable only by apps/api
  api/        REST data layer (createApiClient) + TanStack Query helpers
  api-mocks/  framework-agnostic mock routes + MSW adapter (frontend-only dev)
  validators/ zod schemas + API contracts; single source of runtime truth
  utils/      logger (+ LogSink seam), Intl formatters, generic helpers
  config/     typed env (@t3-oss/env-*) + app config, per-platform
  navigation/ typed route registry + zod search params
  ui/         web-only shadcn DOM
  store/      Zustand app-shell state
  auth/       Better Auth client wrapper (provider, useAuth, AuthGuard)
  i18n/       next-intl (web) + use-intl (mobile) over shared ICU catalogs
  telemetry/  vendor-agnostic capture + analytics seam (Sentry/PostHog)
  flags/      typed feature-flag registry (FE+BE) + PostHog adapter
  realtime/   realtime seam + Centrifugo adapter
  ai/         thin LLM seam: model interfaces + router + noop defaults
              (AI SDK adapter + pgvector conventions as recipes)
docker/       compose (postgres, redis, centrifugo, minio, mailpit) + Dockerfiles
scripts/      setup bootstrap + create-project stamp-out + repo checks
loadtest/     k6 baseline against the reference resource
tooling/      shared tsconfig / eslint / prettier / tailwind / vitest / CI configs
turbo/generators/  @turbo/gen scaffolders (incl. `gen module` — full backend module)
docs/adr/     architecture decision records
docs/operations/   ops runbooks: backup/restore, deploy recipes, incident response
```

## Prerequisites

- Node 24 LTS (see `.nvmrc`)
- pnpm 11 (see `packageManager` in root `package.json`)
- Docker (compose) for the backend dev stack

## Setup

```bash
pnpm run setup            # one-command bootstrap: toolchain check, compose up,
                          # install, build, migrate (idempotent — also repairs
                          # a half set-up checkout). The explicit `run` matters:
                          # pnpm's builtin `setup` shadows the bare form.
```

Manual equivalent / env files:

```bash
pnpm install
docker compose -f docker/compose.yaml up -d
cp apps/api/.env.example apps/api/.env.local
cp apps/web/.env.example apps/web/.env.local
cp apps/mobile/.env.example apps/mobile/.env.local
pnpm --filter api migrate
```

## Common commands

```bash
pnpm dev                  # all apps in parallel (Turbo TUI)
pnpm dev:web              # web only
pnpm lint                 # ESLint across the graph
pnpm check-types          # tsc --noEmit across the graph
pnpm test                 # Vitest (api/web/shared) + Jest (mobile)
pnpm --filter api test:integration   # Testcontainers suite (needs Docker)
pnpm build                # production builds
pnpm gen                  # scaffolders (@turbo/gen) — incl. `pnpm gen module`
pnpm loadtest             # k6 baseline vs the local stack (see loadtest/README.md)
pnpm create-project       # stamp a derived project out of the skeleton (ADR 0042)
```

Per-package: `pnpm --filter <name> <script>`.
