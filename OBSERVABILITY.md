# Observability (ADR 0036)

Three non-overlapping layers: **PostHog** (what users do), **Sentry** (what
broke), **OpenTelemetry** (why it's slow). All vendor-neutral at the seam; all
OFF by default in dev (opt-in by env).

## OpenTelemetry

Boot: the api scripts run `node --import ./dist/otel/loader.js …` — the loader
registers the ESM instrumentation hook and starts the NodeSDK **only when an
exporter is configured**. Standard env vars (read natively by the SDK):

| Var                                                                  | Use                                                                         |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `OTEL_EXPORTER_OTLP_ENDPOINT`                                        | OTLP http collector, e.g. `http://localhost:4318` — setting it enables OTel |
| `OTEL_TRACES_EXPORTER` / `OTEL_METRICS_EXPORTER`                     | `otlp` (default) / `console` (local debugging) / `none`                     |
| `OTEL_EXPORTER_OTLP_TRACES_PROTOCOL` / `OTEL_EXPORTER_OTLP_PROTOCOL` | `http/protobuf` (default) or `http/json` — traces only, see below           |
| `OTEL_METRIC_EXPORT_INTERVAL`                                        | ms between metric exports (default 60000)                                   |
| `OTEL_SERVICE_NAME`                                                  | overrides the inferred `skeleton-api` / `skeleton-worker`                   |
| `OTEL_SDK_DISABLED=true`                                             | hard off                                                                    |

Local smoke: `OTEL_TRACES_EXPORTER=console OTEL_METRICS_EXPORTER=console pnpm --filter api start`.

**Metrics take the SDK's native env path; TRACES do not** (ADR 0131). Supplying
a `spanProcessor` to `NodeSDK` — which the redaction below requires — makes the
SDK skip its own `getSpanProcessorsFromEnv()` entirely, so `apps/api` builds the
trace exporter chain itself in `src/otel/exporter-processors.ts` and reproduces
the contract in the table above. Two consequences of owning it: the trace
protocol matrix is `http/protobuf` | `http/json` only — **`grpc` and `zipkin`
are not supported for traces** and fail with a `diag.error` rather than being
silently substituted — and a traces-configured boot that can build no exporter
logs a `diag.error` instead of dropping spans quietly.

Instrumented: Fastify (`@fastify/otel`), pg, ioredis, pino (every log line
carries `trace_id`/`span_id`), BullMQ (`bullmq-otel` — producer→consumer
context), and the **outbox** (manual W3C propagation: `emit()` stores the
request's `traceparent` in the row; the worker's events processor resumes it,
so a domain event's handler span belongs to the originating request's trace).

### Span-attribute redaction (ADR 0131)

Spans are a THIRD PII sink beside logs and Sentry, and until ADR 0131 nothing
redacted them: `@fastify/otel` writes `url.path` from fastify's **raw** url, so
a `?search=<příjmení>` shipped verbatim to the collector even though the same
value was stripped from every pino line and every Sentry event.

`RedactingSpanProcessor` (registered **first** in the chain, so it runs before
any exporting processor) rewrites attributes in `onStart` — the one point where
the SDK's own `setAttribute` still applies. Rules, all in
`src/otel/redact-attributes.ts`:

| Attribute                                                                                                                           | Treatment                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `url.path`, `url.full`, `http.url`, `http.target`, `url`, `db.connection.string`                                                    | reduced by the URL PARSER to `protocol//host + pathname` — userinfo, query and fragment are never read, so they cannot survive; unparseable or unlisted-scheme values become `[Filtered]`                                                                     |
| `http.route`                                                                                                                        | **kept** — the registered route template, no request data by construction, and what RED dashboards group by                                                                                                                                                   |
| `url.query`, `url.fragment`, `http.query`, `http.fragment`, `query_string`, `search`                                                | `[Filtered]` (bare query/fragment, no path to keep)                                                                                                                                                                                                           |
| `http.request.header.*`, `http.response.header.*`, `db.query.parameter.*`                                                           | `[Filtered]` — whole namespaces, so no header name has to be remembered                                                                                                                                                                                       |
| credential / PII key names (`authorization`, `*.email`, `*.token`, `net.peer.ip`, `enduser.id`, `db.postgresql.values`, `*.ico`, …) | `[Filtered]`, matched on the full key or its last dot-segment                                                                                                                                                                                                 |
| `db.statement` on an **ioredis** span                                                                                               | reduced to the command name — redis args are our KEYS, and throttle keys embed the client IP                                                                                                                                                                  |
| `db.statement` on a **pg** span                                                                                                     | **kept**: it is the parameterized sql text only (`enhancedDatabaseReporting` is off, and its output key `db.postgresql.values` is redacted anyway). A raw `sql` template with an interpolated literal would still ship its value — that is the known residual |
| `db.statement` from any other instrumentation                                                                                       | `[Filtered]` — an unmodelled shape redacts                                                                                                                                                                                                                    |

The URL primitive is a deliberate DUPLICATE of `@repo/telemetry`'s
`safeUrlOrRedact`: the api's pre-boot `--import` loader cannot pull in
`common/logging/redaction.ts` (it drags `@repo/db/schema`) and `@repo/telemetry`
is source-only with no build step. Giving that package a build step so the
primitive can be shared is the owed follow-up.

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
