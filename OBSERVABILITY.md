# Observability (ADR 0036)

Three non-overlapping layers: **PostHog** (what users do), **Sentry** (what
broke), **OpenTelemetry** (why it's slow). All vendor-neutral at the seam; all
OFF by default in dev (opt-in by env).

## OpenTelemetry

Boot: the api scripts run `node --import ./dist/otel/loader.js …` — the loader
registers the ESM instrumentation hook and starts the NodeSDK **only when an
exporter is configured**. Standard env vars (read natively by the SDK):

| Var                                              | Use                                                                         |
| ------------------------------------------------ | --------------------------------------------------------------------------- |
| `OTEL_EXPORTER_OTLP_ENDPOINT`                    | OTLP http collector, e.g. `http://localhost:4318` — setting it enables OTel |
| `OTEL_TRACES_EXPORTER` / `OTEL_METRICS_EXPORTER` | `otlp` (default) / `console` (local debugging) / `none`                     |
| `OTEL_METRIC_EXPORT_INTERVAL`                    | ms between metric exports (default 60000)                                   |
| `OTEL_SERVICE_NAME`                              | overrides the inferred `skeleton-api` / `skeleton-worker`                   |
| `OTEL_SDK_DISABLED=true`                         | hard off                                                                    |

Local smoke: `OTEL_TRACES_EXPORTER=console OTEL_METRICS_EXPORTER=console pnpm --filter api start`.

Instrumented: Fastify (`@fastify/otel`), pg, ioredis, pino (every log line
carries `trace_id`/`span_id`), BullMQ (`bullmq-otel` — producer→consumer
context), and the **outbox** (manual W3C propagation: `emit()` stores the
request's `traceparent` in the row; the worker's events processor resumes it,
so a domain event's handler span belongs to the originating request's trace).

## Golden signals (alert on these)

- **RED** per route — from the Fastify instrumentation (`http.server.*`).
- **`queue.jobs`** `{queue, state}` — waiting growth = consumers behind;
  `failed` growth = DLQ filling.
- **`outbox.pending` / `outbox.lag_seconds`** — relay health; lag > relay
  interval × 10 means events aren't flowing (THE async-machinery alarm).
- **`db.pool.connections`** `{state}` — `waiting > 0` sustained = pool
  saturation (ADR 0038: raise pool size × replicas math, or add PgBouncer).

## Sentry (errors)

`SENTRY_DSN` set → enabled (api + worker). `beforeSend` scrubs cookies/auth
headers and every PII-registry column name (`@repo/db/pii`);
`sendDefaultPii` stays false. Unhandled 500s are captured with the request id.

## PostHog (product analytics + flags)

Backend: `POSTHOG_API_KEY` set → `AnalyticsService.capture()` is live
(EU host default). Server-side flags read the SAME typed registry as the
frontend (`@repo/flags`). Frontend ingestion goes first-party through the
`/ingest` Next.js rewrite. Consent: flags carry a `requiresConsent`
annotation; client-side PostHog boot is consent-gated, anonymous server-side
evaluation stays allowed.

## Logs

pino JSON to stdout (collector-agnostic). Redaction by default: auth
material + PII-registry-derived body paths (`common/logging/redaction.ts`).
A redact **path** cannot reach a value spliced into a **string**: pino logs the
querystring inside `req.url`, and emits a parsed `req.query` object whose param
keys (`q`) aren't schema columns — so a `?q=<email>` search over a `pii()`
column is reachable by no pii()-derived path on either surface.
`redactedReqSerializer` closes both fail-closed: it cuts the querystring off
`req.url` and drops the parsed `query` object entirely (a project that needs
specific non-PII params logged re-adds them deliberately). It reshapes
pino-http's already-serialized request — it must not re-serialize, or
`remoteAddress`/`remotePort` are silently dropped from every log line.
`x-request-id` is honored/generated per request and stamped on audit rows.
