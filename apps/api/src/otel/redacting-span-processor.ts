/**
 * The catch-all span redactor (ADR 0131).
 *
 * A `SpanProcessor` rather than a per-instrumentation hook, deliberately.
 * `@fastify/otel` has a `requestHook`, `instrumentation-ioredis` has a
 * `dbStatementSerializer`, and wiring those two would close today's two known
 * leaks with less machinery — but each is a rule attached to ONE emitter, and
 * the next instrumentation anybody adds (undici, mongo, a vendor SDK) arrives
 * with no rule attached to it at all. A processor sees EVERY span from EVERY
 * scope, which is what makes "an unmodelled shape redacts" (ADR 1030) an actual
 * property of this pipeline rather than a claim about the emitters we happen to
 * have installed today.
 *
 * WHY `onStart` AND NOT `onEnd`. `onEnd` receives a `ReadableSpan`, whose
 * `attributes` object is mutable in practice (the `readonly` modifier is on the
 * property, not on the object) — and mutating it there would bypass
 * `attributeCountLimit` / `attributeValueLengthLimit` and the SDK's own
 * `_attributesCount`, i.e. it works until it silently does not. The supported
 * write, `setAttribute`, is a NO-OP after the span has ended AND emits a
 * `diag.warn` carrying a constructed stack — once per span, on the hot path,
 * with nothing red. `onStart` has neither problem: `SpanImpl`'s constructor
 * applies the creation-time attribute bag and THEN calls
 * `_spanProcessor.onStart(this, …)`, so every attribute we care about
 * (`url.path`, `db.statement`) is already populated and the span is still
 * writable.
 *
 * WHY NOT `onEnding`. It is the other supported write point and it would also
 * catch attributes set mid-span — but it is marked `@experimental` ("may break
 * in minor versions") in the installed `@opentelemetry/sdk-trace-base` 2.7.1
 * type declarations, and the otel packages are catalog-pinned EXACT precisely
 * because their 0.x/2.x minors churn. The cost of skipping it is bounded and
 * named in ADR 0131: an attribute written after span start (a `responseHook`,
 * an application `span.setAttribute`) is not seen by this processor.
 *
 * ORDERING. `MultiSpanProcessor` fans out in ARRAY ORDER, so this processor
 * must be registered FIRST — see `exporter-processors.ts`, which owns the
 * composition and is tested for exactly that.
 */
// `@opentelemetry/sdk-node` re-exports `@opentelemetry/sdk-trace-base`
// wholesale as `tracing` (its index.d.ts line 8). Going through the namespace
// costs no new dependency — `sdk-trace-base` is transitive-only and would not
// even RESOLVE from apps/api under pnpm's strict layout — and it cannot
// version-skew from the SDK that will consume the processor.
import { tracing } from "@opentelemetry/sdk-node";

import { redactAttributes } from "./redact-attributes.js";

export class RedactingSpanProcessor implements tracing.SpanProcessor {
  /**
   * The interface passes `(span, parentContext)`; the trailing parameter is
   * omitted rather than underscore-prefixed because `lint` runs at
   * `--max-warnings 0` and a narrower implementation is assignable. Redaction is
   * a function of the span alone — nothing here reads the parent context.
   */
  onStart(span: tracing.Span): void {
    const overwrites = redactAttributes(span.instrumentationScope.name, span.attributes);
    for (const [key, value] of Object.entries(overwrites)) {
      span.setAttribute(key, value);
    }
  }

  /**
   * Intentionally empty (and the `ReadableSpan` parameter intentionally
   * omitted). Everything is rewritten in `onStart`; doing anything here would be
   * either unsupported (mutating `attributes`) or a silent no-op plus per-span
   * `diag.warn` noise (`setAttribute` on an ended span).
   */
  onEnd(): void {
    // no-op
  }

  /** Nothing is buffered here — the exporting processors own flushing. */
  forceFlush(): Promise<void> {
    return Promise.resolve();
  }

  /** Nothing to release. */
  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}
