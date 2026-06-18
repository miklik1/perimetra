import { redactString, scrubBreadcrumb, scrubEvent } from "./scrub";

/**
 * Shared Sentry init-options builder (ADR 0021). SDK-FREE — it returns a plain
 * object whose scrub hooks are the generic functions from `./scrub`, so it
 * lives in the neutral module and BOTH platform bindings (`./web`, `./native`)
 * re-export it. That single-homes the security-critical wiring: the PII
 * scrubber lands in `beforeSend`/`beforeBreadcrumb` once, and a change to the
 * scrub contract can't be applied to one platform and missed on the other.
 * The apps spread the result into their `Sentry.init` (instrumentation files
 * on web; the mobile boot file when mobile telemetry wires up).
 */
export interface SentryInitConfig {
  dsn: string;
  /** Sentry environment tag, e.g. `"production"`. */
  environment?: string;
  /** Perf-tracing sample rate 0–1. Default `0` (errors only). */
  tracesSampleRate?: number;
  /** SDK debug logging (dev verification). */
  debug?: boolean;
}

/**
 * Span-aware PII scrubber for `beforeSendSpan`. Raw spans are a SEPARATE
 * envelope path in Sentry v10 and are NOT event-shaped: the free-text PII rides
 * in `description` (SQL statements, HTTP URLs with query strings) and in the
 * `data` attribute bag (`url.full`, `db.statement`, `url.query`, …). We redact
 * only those — structural identifiers (`span_id`, `trace_id`, `op`, timestamps)
 * are left intact so trace correlation and grouping survive, where a blind
 * `scrubEvent` walk could rewrite an all-digit id (the rodné-číslo value
 * pattern). Generic + cast like `scrubEvent`, so this SDK-free module needn't
 * import Sentry's `SpanJSON` type.
 */
function scrubSpan<S extends { description?: string; data?: Record<string, unknown> }>(span: S): S {
  const redact = (value: unknown): unknown =>
    typeof value === "string"
      ? redactString(value)
      : Array.isArray(value)
        ? value.map(redact)
        : value;
  const { data } = span;
  return {
    ...span,
    description: span.description != null ? redactString(span.description) : span.description,
    data: data
      ? (Object.fromEntries(Object.entries(data).map(([k, v]) => [k, redact(v)])) as Record<
          string,
          unknown
        >)
      : data,
  } as S;
}

/**
 * Init options with the PII scrubber pre-wired into every Sentry envelope
 * pipeline (the package owns the scrub obligation; app init files stay
 * one-liners). Errors go through `beforeSend`/`beforeBreadcrumb`; tracing is a
 * separate path in v10 — `beforeSendTransaction` (transactions are event-shaped,
 * so `scrubEvent` is reused) and `beforeSendSpan` (the span-shaped scrubber)
 * are required or span descriptions, full URLs with query strings, and DB
 * statements ship unscrubbed once `tracesSampleRate > 0`. The shape is the
 * shared subset of the Sentry client / server / native option types.
 */
export function buildSentryOptions(config: SentryInitConfig) {
  return {
    dsn: config.dsn,
    environment: config.environment,
    tracesSampleRate: config.tracesSampleRate ?? 0,
    debug: config.debug ?? false,
    beforeSend: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
    beforeSendTransaction: scrubEvent,
    beforeSendSpan: scrubSpan,
  };
}
