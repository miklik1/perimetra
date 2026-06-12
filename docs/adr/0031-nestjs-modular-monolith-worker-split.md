# ADR 0031 — Backend: NestJS 11 on Fastify, modular monolith + worker split

**Status:** Accepted (2026-06-10). First backend ADR — the repo became the
fullstack skeleton (see the design spec at
`docs/superpowers/specs/2026-06-10-fullstack-skeleton-design.md`).

## Context

The skeleton gains a backend that will seed ~10 client projects over a
~10-year horizon, with scalability as the structural priority. The framework
(NestJS) was a given; the architecture inside it was not. Day-one
microservices were considered and rejected: their cost is operational
(distributed failures, deploy orchestration, cross-service consistency), paid
at runtime on every derived project forever — AI-era authoring speed does not
reduce it.

## Decision

- **NestJS 11 on the Fastify 5 adapter** (`@nestjs/platform-fastify`), ESM
  (NodeNext) from day one — NestJS 12 is a full-ESM migration, so the build
  posture is already aligned.
- **Modular monolith, three deployables from ONE image/codebase:**
  - `main.ts` — HTTP api,
  - `worker.ts` — BullMQ consumer + outbox relay (ADR 0037), scaled
    independently of HTTP load,
  - `migrate.ts` — one-shot migration release phase (ADR 0038).
- **Strict module boundaries:** a domain module owns its tables (per-module
  schema exports, ADR 0032), queues, events, and contracts; cross-module
  access only through a module's exported public surface — never another
  module's tables. Enforced with ESLint (the ADR 0011 mechanism extended to
  the data layer). This keeps every module _extractable_ into a standalone
  service along an existing seam — microservices headroom without the
  day-one tax.
- **Domain-layer position:** transaction-script services are fine; extract a
  repository when a query is reused; cross-module screens compose via the
  owning module's exported query service or an explicit read-model module
  (CQRS-lite) — never via joins across module schemas.
- Both long-running deployables are **stateless** (shared state in
  Postgres/Redis), with terminus liveness/readiness probes and graceful
  shutdown — horizontal scaling on any container platform is the deploy
  contract.

## Consequences

- One codebase to maintain per project; scaling is `replicas: N` on two
  deployables; a real bottleneck can be carved out along module seams later.
- Backend packages (`@repo/db`, future backend `@repo/*`) are **built**
  (tsc → `dist/`), unlike the source-only frontend packages — Nest's tsc
  build can't compile TS out of `node_modules`, and the template-lifecycle
  plan publishes these packages anyway (ADR 0042, Phase 8).
- Vitest (not Jest) tests the api via `unplugin-swc` (decorator metadata) —
  the ADR 0005 two-runner rule is preserved: Jest remains mobile-only.
