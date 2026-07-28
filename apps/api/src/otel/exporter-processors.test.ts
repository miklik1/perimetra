import { diag } from "@opentelemetry/api";
import { OTLPTraceExporter as OtlpHttpJsonTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPTraceExporter as OtlpProtobufTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { tracing } from "@opentelemetry/sdk-node";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildSpanProcessors, buildTraceExporterProcessors } from "./exporter-processors.js";
import { RedactingSpanProcessor } from "./redacting-span-processor.js";

/**
 * The exporter a processor was built around. `BatchSpanProcessor` keeps it as
 * `_exporter`; there is no public accessor, and asserting on the CLASS is the
 * only way to prove the wire protocol was not silently narrowed.
 */
function exporterOf(processor: tracing.SpanProcessor): unknown {
  return (processor as unknown as { _exporter: unknown })._exporter;
}

afterEach(async () => {
  vi.restoreAllMocks();
});

describe("buildTraceExporterProcessors — the env matrix we now own (ADR 0131)", () => {
  it("defaults to a batched OTLP http/protobuf exporter when only the endpoint is set", async () => {
    const processors = buildTraceExporterProcessors({
      OTEL_EXPORTER_OTLP_ENDPOINT: "http://localhost:4318",
    });

    expect(processors).toHaveLength(1);
    expect(processors[0]).toBeInstanceOf(tracing.BatchSpanProcessor);
    // http/protobuf is the OTLP spec default. Narrowing it to http/json — the
    // exporter apps/api already declared — would have made OBSERVABILITY.md a lie.
    expect(exporterOf(processors[0]!)).toBeInstanceOf(OtlpProtobufTraceExporter);
    await processors[0]!.shutdown();
  });

  it("honours the traces-specific protocol var over the generic one", async () => {
    const processors = buildTraceExporterProcessors({
      OTEL_EXPORTER_OTLP_PROTOCOL: "http/protobuf",
      OTEL_EXPORTER_OTLP_TRACES_PROTOCOL: "http/json",
    });

    expect(exporterOf(processors[0]!)).toBeInstanceOf(OtlpHttpJsonTraceExporter);
    await processors[0]!.shutdown();
  });

  it("treats an empty protocol var as unset rather than as an unknown protocol", async () => {
    const processors = buildTraceExporterProcessors({ OTEL_EXPORTER_OTLP_PROTOCOL: "  " });

    expect(exporterOf(processors[0]!)).toBeInstanceOf(OtlpProtobufTraceExporter);
    await processors[0]!.shutdown();
  });

  it("pairs the console exporter with a SIMPLE processor so a local smoke prints at once", async () => {
    const processors = buildTraceExporterProcessors({ OTEL_TRACES_EXPORTER: "console" });

    expect(processors).toHaveLength(1);
    expect(processors[0]).toBeInstanceOf(tracing.SimpleSpanProcessor);
    expect(exporterOf(processors[0]!)).toBeInstanceOf(tracing.ConsoleSpanExporter);
    await processors[0]!.shutdown();
  });

  it("builds nothing for none, and does not call that an error", () => {
    const error = vi.spyOn(diag, "error").mockImplementation(() => undefined);
    vi.spyOn(diag, "warn").mockImplementation(() => undefined);

    expect(buildTraceExporterProcessors({ OTEL_TRACES_EXPORTER: "none" })).toEqual([]);
    expect(error).not.toHaveBeenCalled();
  });

  it("fails LOUD when traces are asked for and nothing can export them", () => {
    const error = vi.spyOn(diag, "error").mockImplementation(() => undefined);

    // grpc is in sdk-node's matrix and deliberately not in ours.
    const processors = buildTraceExporterProcessors({ OTEL_EXPORTER_OTLP_PROTOCOL: "grpc" });

    expect(processors).toEqual([]);
    // Once for the unsupported protocol, once for the empty chain — silence is
    // the whole danger of owning this wiring, so both must be audible.
    expect(error).toHaveBeenCalledTimes(2);
    expect(error.mock.calls.map(String).join("\n")).toMatch(/grpc/);
    expect(error.mock.calls.map(String).join("\n")).toMatch(/DISCARDED/);
  });

  it("fails LOUD on an unrecognized exporter name", () => {
    const error = vi.spyOn(diag, "error").mockImplementation(() => undefined);

    expect(buildTraceExporterProcessors({ OTEL_TRACES_EXPORTER: "zipkin" })).toEqual([]);
    expect(error).toHaveBeenCalled();
  });
});

describe("buildSpanProcessors — the composed chain (ADR 0131)", () => {
  it("puts the redactor FIRST, because MultiSpanProcessor fans out in array order", async () => {
    const processors = buildSpanProcessors({ OTEL_TRACES_EXPORTER: "console" });

    expect(processors).toHaveLength(2);
    expect(processors[0]).toBeInstanceOf(RedactingSpanProcessor);
    expect(processors[1]).toBeInstanceOf(tracing.SimpleSpanProcessor);
    await processors[1]!.shutdown();
  });

  it("returns an EMPTY array when nothing exports, so no tracer provider is registered", () => {
    vi.spyOn(diag, "warn").mockImplementation(() => undefined);

    // Padding this with a lone redactor would make sdk.js register a provider
    // that records spans and drops them — the exact silent failure ADR 0131 is
    // about, reintroduced from the other side.
    expect(buildSpanProcessors({ OTEL_TRACES_EXPORTER: "none" })).toEqual([]);
  });
});
