# ADR 0036 — Backend observability & analytics: OTel + Sentry + PostHog

**Status:** Accepted (2026-06-11). Amends [ADR 0021](0021-telemetry-observability-package.md)
and [ADR 0028](0028-feature-flags-posthog.md) (extends both to the backend).
Implemented; live-proven (cross-process trace continuity, no-keys silence).

## Context

Three non-overlapping layers (the 0021/0028 philosophy, now full-stack):
**PostHog** = what users do, **Sentry** = what broke, **OTel** = why it's
slow. Everything must be a silent no-op without configuration — observability
is opt-in per project, never a boot dependency.

## Decision

**OpenTelemetry** (traces + metrics, vendor-neutral):

- Boot via `node --import ./dist/otel/loader.js` — registers the ESM
  instrumentation hook (`module.register`, not the deprecated loader flag)
  and starts the NodeSDK ONLY when an exporter is configured; standard
  `OTEL_*` env vars are honored natively (console exporters for local
  debugging).
- **Explicit instrumentations, exact-pinned** — no `auto-instrumentations`
  meta-package (0.x minors break): `@fastify/otel` (the Fastify-team
  replacement for the removed contrib package), pg, ioredis, pino
  (`trace_id`/`span_id` in every log line), `bullmq-otel` via the queue
  `telemetry` option.
- **Outbox trace continuity** (closes the ADR 0037 `traceparent` column):
  `emit()` injects the active W3C context into the row; the worker's events
  processor extracts it and parents the handler span. Proven live: ONE
  traceId spans the HTTP archive request (root + BEGIN/UPDATE/INSERT/COMMIT)
  in the api process and the `event project.archived` span in the worker.
- **Async-machinery gauges** (`otel/metrics.module.ts`): `queue.jobs`
  {queue,state}, `outbox.pending`, `outbox.lag_seconds`,
  `db.pool.connections` {state}. `OBSERVABILITY.md` names the golden signals
  and alert attach points.

**Sentry** (errors only): opt-in by `SENTRY_DSN`; `skipOpenTelemetrySetup`
(one OTel SDK in the process — ours) and `tracesSampleRate: 0`. Captured from
the global filter's 500 branch. `beforeSend` scrubber (tested) masks
cookies/auth headers and every key matching the PII registry — which also
drives pino redaction (`common/logging/redaction.ts`): **declaring `pii()` on
a column is the single step for both log and error-report redaction.**

**PostHog** (product analytics + flags, server side):

- `@repo/flags` is THE registry for frontend AND backend: it gained a built
  `./server` subpath (the `@repo/i18n/server` precedent) and per-flag
  `requiresConsent` annotations (client evaluation of such flags is gated on
  consent; anonymous server-side evaluation and defaults stay allowed).
- `AnalyticsModule`: posthog-node client (null → all methods no-op), EU Cloud
  host default, `POSTHOG_PERSONAL_API_KEY` enables local flag evaluation
  (each process polls independently — upstream has no shared cache).
  `getFlag` falls back to registry defaults and feature-detects the v5
  snapshot API with the stable per-flag call as fallback.
- Server-side capture for events clients can't be trusted with — the projects
  events handler emits `project_created`/`project_archived` (distinctId =
  owner, IDs only).
- Web ingestion goes first-party through `/ingest/*` Next rewrites
  (ad-blocker-resistant), EU hosts.
- GDPR: the ADR 0040 purge seam went real — `PosthogPurgeHook` deletes the
  person + events via REST; `SentryPurgeHook` is an HONEST no-op-with-log
  (no per-user server deletion API exists — data is minimized at source by
  the scrubber; residual deletion is a manual Sentry request).

## Consequences

- A project enables observability by setting env vars — zero code.
- `turbo test` now depends on `^build` (api tests import built subpaths —
  was a latent clean-machine CI failure).
- Known risk: OTel instrumentation packages are 0.x and exact-pinned — bumps
  are deliberate, with the console-exporter smoke as the gate.
