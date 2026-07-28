/**
 * The trace span-processor chain (ADR 0131) — the redactor plus the exporting
 * processors, in the order `MultiSpanProcessor` will fan out.
 *
 * THIS MODULE EXISTS BECAUSE OF A TRAP, and the trap is the single most
 * important thing on this page. In `@opentelemetry/sdk-node` 0.218.0, passing
 * `spanProcessors` to the `NodeSDK` constructor REPLACES the env-driven
 * exporter wiring entirely:
 *
 *   sdk.js:119-143  the `_tracerProviderConfig` branch is entered iff
 *                   `traceExporter || spanProcessor || spanProcessors` is set
 *   sdk.js:226-228  `const spanProcessors = this._tracerProviderConfig
 *                      ? this._tracerProviderConfig.spanProcessors
 *                      : getSpanProcessorsFromEnv();`
 *
 * So `new NodeSDK({ spanProcessors: [redactor] })` yields a tracer provider
 * holding ONLY the redactor and NO exporter. The SDK starts, spans are created,
 * nothing throws, nothing is logged — and not one trace ever reaches the
 * collector again. That failure is invisible to every test we could write about
 * redaction, which is why the exporter construction is owned here, next to the
 * redactor, rather than left implicit.
 *
 * WHAT WE OWE IN RETURN. Owning the chain means owning the env contract
 * `OBSERVABILITY.md` documents, so this reimplements sdk-node's
 * `getSpanProcessorsFromEnv()` faithfully rather than conveniently:
 * `OTEL_TRACES_EXPORTER` (`otlp` default | `console` | `none`, comma-list
 * tolerated) and, for otlp, the protocol from
 * `OTEL_EXPORTER_OTLP_TRACES_PROTOCOL ?? OTEL_EXPORTER_OTLP_PROTOCOL ??
 * "http/protobuf"`. Quietly narrowing the default to `http/json` — the exporter
 * apps/api already declared — would have been a one-line change that made the
 * documented contract a lie for anyone who set only the endpoint, so
 * `@opentelemetry/exporter-trace-otlp-proto` is now a declared dependency at
 * the same catalog pin as its siblings.
 *
 * WHAT WE DELIBERATELY DO NOT SUPPORT: `grpc` and `zipkin`. Both are in
 * sdk-node's env matrix; neither is in `OBSERVABILITY.md`'s (which describes an
 * "OTLP http collector"), and supporting them would pull `@grpc/grpc-js` and a
 * zipkin exporter into the production image for a path nothing exercises. They
 * fail LOUD (a `diag.error` naming the value) and produce no exporter — never a
 * silent substitution, because shipping protobuf at a gRPC endpoint is a
 * failure that looks like a network problem for a week.
 */
import { diag } from "@opentelemetry/api";
import { OTLPTraceExporter as OtlpHttpJsonTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPTraceExporter as OtlpProtobufTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { tracing } from "@opentelemetry/sdk-node";

import { RedactingSpanProcessor } from "./redacting-span-processor.js";

/** Only the env this module reads — injectable so the matrix is testable. */
export type TraceExporterEnv = Readonly<Record<string, string | undefined>>;

/**
 * Read an env var the way the OTel spec does: an EMPTY or whitespace-only value
 * is "unset", not "the empty string". `isOtelEnabled()` uses a bare `??` chain
 * and therefore treats `OTEL_EXPORTER_OTLP_ENDPOINT=""` as set-but-falsy; do
 * not repeat that here, or `OTEL_EXPORTER_OTLP_PROTOCOL=""` would fall through
 * to the unsupported-protocol branch instead of to the default.
 */
function readEnv(env: TraceExporterEnv, key: string): string | undefined {
  const raw = env[key]?.trim();
  return raw === undefined || raw === "" ? undefined : raw;
}

/**
 * Resolve `OTEL_TRACES_EXPORTER` to a list of exporter names. An empty result
 * means "traces are configured OFF" and is not an error.
 */
function resolveExporterNames(env: TraceExporterEnv): string[] {
  const configured = [
    ...new Set(
      (readEnv(env, "OTEL_TRACES_EXPORTER") ?? "")
        .split(",")
        .map((name) => name.trim())
        // sdk-node drops the literal string "null" here; keep the parity.
        .filter((name) => name !== "" && name !== "null"),
    ),
  ];

  if (configured[0] === "none") {
    diag.warn('OTEL_TRACES_EXPORTER contains "none". Traces will not be exported.');
    return [];
  }
  if (configured.length === 0) return ["otlp"];
  if (configured.includes("none")) {
    diag.warn(
      'OTEL_TRACES_EXPORTER contains "none" along with other exporters. Using the default otlp exporter.',
    );
    return ["otlp"];
  }
  return configured;
}

/**
 * The OTLP exporter for the configured protocol. Endpoint, headers, timeout and
 * compression are read by the exporter itself from the standard `OTEL_*` vars —
 * we choose the wire format and nothing else.
 */
function otlpTraceExporter(env: TraceExporterEnv): tracing.SpanExporter | undefined {
  const protocol =
    readEnv(env, "OTEL_EXPORTER_OTLP_TRACES_PROTOCOL") ??
    readEnv(env, "OTEL_EXPORTER_OTLP_PROTOCOL") ??
    "http/protobuf";

  switch (protocol) {
    case "http/protobuf":
      return new OtlpProtobufTraceExporter();
    case "http/json":
      return new OtlpHttpJsonTraceExporter();
    default:
      diag.error(
        `Unsupported OTLP traces protocol "${protocol}" — this service supports http/protobuf and http/json only (see OBSERVABILITY.md). No trace exporter was created.`,
      );
      return undefined;
  }
}

/**
 * The EXPORTING processors alone, in `OTEL_TRACES_EXPORTER` order. Exported for
 * the test matrix; production composes through `buildSpanProcessors`.
 */
export function buildTraceExporterProcessors(
  env: TraceExporterEnv = process.env,
): tracing.SpanProcessor[] {
  const names = resolveExporterNames(env);
  const processors: tracing.SpanProcessor[] = [];

  for (const name of names) {
    switch (name) {
      case "console":
        // A console exporter must not be batched, or a `pnpm --filter api start`
        // smoke shows nothing for 5 seconds. Same pairing sdk-node makes.
        processors.push(new tracing.SimpleSpanProcessor(new tracing.ConsoleSpanExporter()));
        break;
      case "otlp": {
        const exporter = otlpTraceExporter(env);
        if (exporter) processors.push(new tracing.BatchSpanProcessor(exporter));
        break;
      }
      default:
        diag.error(
          `Unrecognized OTEL_TRACES_EXPORTER value "${name}" — this service supports otlp, console and none (see OBSERVABILITY.md).`,
        );
    }
  }

  // THE LOUD FAILURE MODE. Traces were asked for and we built nothing to export
  // them with; because we own the chain, sdk-node's own warning never fires.
  // Silence is the trap's whole danger, so this is an error, not a warning.
  if (names.length > 0 && processors.length === 0) {
    diag.error(
      "OTel traces are configured but no trace exporter could be constructed — spans will be recorded and DISCARDED. Check OTEL_TRACES_EXPORTER and OTEL_EXPORTER_OTLP_(TRACES_)PROTOCOL.",
    );
  }

  return processors;
}

/**
 * The full chain handed to `NodeSDK`. The redactor is FIRST, before every
 * exporting processor — `MultiSpanProcessor` fans out in array order, and a
 * redactor placed after an exporter would be a green test suite over a live
 * leak.
 *
 * An empty array is returned when nothing exports, which reproduces the SDK's
 * own `OTEL_TRACES_EXPORTER=none` behaviour exactly: `sdk.js` skips registering
 * a tracer provider when the array is empty, so we must not pad it with a
 * redactor that would have nothing to redact for.
 */
export function buildSpanProcessors(env: TraceExporterEnv = process.env): tracing.SpanProcessor[] {
  const exporters = buildTraceExporterProcessors(env);
  if (exporters.length === 0) return [];
  return [new RedactingSpanProcessor(), ...exporters];
}
