/**
 * OTel NodeSDK boot (ADR 0036). Exporters are configured by the STANDARD env
 * vars:
 *   OTEL_EXPORTER_OTLP_ENDPOINT, OTEL_TRACES_EXPORTER (otlp|console|none),
 *   OTEL_METRICS_EXPORTER, OTEL_METRIC_EXPORT_INTERVAL, OTEL_SERVICE_NAME...
 * See OBSERVABILITY.md.
 *
 * METRICS still take the SDK's native env path. TRACES no longer can, because
 * of ADR 0131: span attributes ship raw otherwise (`@fastify/otel` writes
 * `url.path` from fastify's RAW url, querystring included), and the only
 * catch-all place to fix that is a `SpanProcessor` — but supplying
 * `spanProcessors` makes sdk-node SKIP `getSpanProcessorsFromEnv()` entirely
 * (sdk.js:226-228), so a redactor added on its own would silently stop every
 * trace from reaching the collector. We therefore own the whole trace chain:
 * `buildSpanProcessors()` reproduces the documented env contract and puts the
 * redactor first. Read `exporter-processors.ts` before touching this.
 *
 * Instrumentations are EXPLICIT (no auto-instrumentations meta-package — its
 * 0.x minors break; we pin exactly what we run): fastify (official
 * @fastify/otel), pg, ioredis, pino (trace_id/span_id into every log line).
 * BullMQ spans come from bullmq-otel via the queue/worker `telemetry` option
 * (jobs.module). Outbox trace continuity is manual (outbox.service /
 * events.processor) — W3C traceparent through the database row.
 */
import { FastifyOtelInstrumentation } from "@fastify/otel";
import { IORedisInstrumentation } from "@opentelemetry/instrumentation-ioredis";
import { PgInstrumentation } from "@opentelemetry/instrumentation-pg";
import { PinoInstrumentation } from "@opentelemetry/instrumentation-pino";
import { NodeSDK } from "@opentelemetry/sdk-node";

import { buildSpanProcessors } from "./exporter-processors.js";

const entrypoint = process.argv[1] ?? "";
const inferredService = entrypoint.includes("worker")
  ? "skeleton-worker"
  : entrypoint.includes("migrate")
    ? "skeleton-migrate"
    : "skeleton-api";

const sdk = new NodeSDK({
  serviceName: process.env.OTEL_SERVICE_NAME ?? inferredService,
  // An EMPTY array is the correct "traces off" value, not a reason to omit the
  // key: sdk.js skips registering a tracer provider when the resolved array is
  // empty, which is exactly what the env path does for OTEL_TRACES_EXPORTER=none.
  spanProcessors: buildSpanProcessors(),
  instrumentations: [
    new FastifyOtelInstrumentation({ registerOnInitialization: true }),
    new PgInstrumentation(),
    new IORedisInstrumentation(),
    new PinoInstrumentation(),
  ],
});

sdk.start();

let shuttingDown = false;
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    // Nest's shutdown hooks run on the same signal; flush in parallel.
    void sdk.shutdown().catch(() => undefined);
  });
}
process.on("beforeExit", () => {
  if (!shuttingDown) {
    shuttingDown = true;
    void sdk.shutdown().catch(() => undefined);
  }
});
