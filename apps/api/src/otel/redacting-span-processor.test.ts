import { ROOT_CONTEXT } from "@opentelemetry/api";
import { tracing } from "@opentelemetry/sdk-node";
import { describe, expect, it, vi } from "vitest";

import { REDACTED } from "./redact-attributes.js";
import { RedactingSpanProcessor } from "./redacting-span-processor.js";

/**
 * Always typed as the INTERFACE, never as the class. The SDK calls
 * `onStart(span, parentContext)` and `onEnd(span)`; our implementation declares
 * neither trailing parameter (it needs neither, and `lint` runs at
 * `--max-warnings 0`), so it must stay ASSIGNABLE to the wider signature. A
 * class-typed local would quietly stop testing that.
 */
function newProcessor(): tracing.SpanProcessor {
  return new RedactingSpanProcessor();
}

/**
 * A stand-in for `SpanImpl` at the exact moment `onStart` fires: the
 * creation-time attribute bag is already applied and `setAttribute` still
 * works. Structural, not a mock of the class — the processor may only use the
 * members declared here, which is itself part of what this pins.
 */
function fakeSpan(scopeName: string, attributes: Record<string, unknown>) {
  const applied: Record<string, unknown> = { ...attributes };
  return {
    span: {
      instrumentationScope: { name: scopeName, version: "0.0.0" },
      attributes: applied,
      setAttribute(key: string, value: unknown) {
        applied[key] = value;
        return this;
      },
    } as unknown as tracing.Span,
    applied,
  };
}

describe("RedactingSpanProcessor (ADR 0131)", () => {
  it("rewrites through setAttribute in onStart, before the span can be exported", () => {
    const { span, applied } = fakeSpan("@fastify/otel", {
      "url.path": "/v1/customers?search=Nováková",
      "http.route": "/v1/customers",
    });

    newProcessor().onStart(span, ROOT_CONTEXT);

    expect(applied["url.path"]).toBe("/v1/customers");
    expect(applied["http.route"]).toBe("/v1/customers");
  });

  it("uses the instrumentation scope to decide, not the value's shape", () => {
    const processor = newProcessor();
    const redis = fakeSpan("@opentelemetry/instrumentation-ioredis", {
      "db.statement": "del bull:documents:1 bull:documents:2",
    });
    const pg = fakeSpan("@opentelemetry/instrumentation-pg", {
      "db.statement": 'select "id" from "customer" where "id" = $1',
    });

    processor.onStart(redis.span, ROOT_CONTEXT);
    processor.onStart(pg.span, ROOT_CONTEXT);

    expect(redis.applied["db.statement"]).toBe("del");
    expect(pg.applied["db.statement"]).toBe('select "id" from "customer" where "id" = $1');
  });

  it("touches nothing when there is nothing to redact", () => {
    const { span, applied } = fakeSpan("@opentelemetry/instrumentation-pg", {
      "db.name": "perimetra",
    });
    const setAttribute = vi.spyOn(span, "setAttribute");

    newProcessor().onStart(span, ROOT_CONTEXT);

    expect(setAttribute).not.toHaveBeenCalled();
    expect(applied).toEqual({ "db.name": "perimetra" });
  });

  it("leaves onEnd a no-op: setAttribute is a silent no-op plus a diag.warn after end", () => {
    // A ReadableSpan carrying an UNREDACTED value, frozen. If onEnd ever grew a
    // mutation, this throws instead of silently corrupting a limit-tracked bag.
    const ended = Object.freeze({
      instrumentationScope: { name: "@fastify/otel", version: "0.0.0" },
      attributes: Object.freeze({ "url.path": "/v1/customers?search=Nováková" }),
    }) as unknown as tracing.ReadableSpan;

    expect(() => newProcessor().onEnd(ended)).not.toThrow();
    expect(ended.attributes["url.path"]).toBe("/v1/customers?search=Nováková");
  });

  it("implements the whole SpanProcessor lifecycle so the SDK can flush and shut down", async () => {
    const processor = newProcessor();

    await expect(processor.forceFlush()).resolves.toBeUndefined();
    await expect(processor.shutdown()).resolves.toBeUndefined();
  });

  /**
   * The one claim the structural fakes above cannot make. Everything else here
   * assumes `SpanImpl`'s constructor applies the creation-time attribute bag
   * BEFORE it calls `_spanProcessor.onStart(this, …)`; if that ordering were
   * wrong, `onStart` would see an empty bag and every other test in this file
   * would still pass. Drive a REAL provider and a REAL span to settle it.
   */
  it("sees a real SDK span's creation-time attributes, already populated, in onStart", async () => {
    const provider = new tracing.BasicTracerProvider({
      spanProcessors: [new RedactingSpanProcessor()],
    });
    const span = provider.getTracer("@fastify/otel").startSpan("GET /v1/customers", {
      attributes: {
        "url.path": "/v1/customers?search=Nováková",
        "http.route": "/v1/customers",
      },
    });

    expect((span as unknown as tracing.ReadableSpan).attributes["url.path"]).toBe("/v1/customers");
    expect((span as unknown as tracing.ReadableSpan).attributes["http.route"]).toBe(
      "/v1/customers",
    );

    span.end();
    await provider.shutdown();
  });

  it("redacts an unmodelled sensitive attribute nobody wired a hook for", () => {
    // The reason this is a processor and not a @fastify/otel requestHook: a
    // scope with no hook of its own is still covered.
    const { span, applied } = fakeSpan("bullmq-otel", {
      "messaging.recipient_email": "jan@example.cz",
    });

    newProcessor().onStart(span, ROOT_CONTEXT);

    expect(applied["messaging.recipient_email"]).toBe(REDACTED);
  });
});
