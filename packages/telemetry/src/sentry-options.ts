import { scrubBreadcrumb, scrubEvent, scrubSpan } from "./scrub";

/**
 * Shared Sentry init-options builder (ADR 0021). SDK-FREE — it returns a plain
 * object whose scrub hooks are the generic functions from `./scrub`, so it
 * lives in the neutral module and BOTH platform bindings (`./web`, `./native`)
 * re-export it. That single-homes the security-critical wiring: the PII
 * scrubber lands in `beforeSend`/`beforeBreadcrumb`/`beforeSendTransaction`/
 * `beforeSendSpan` once, and a change to the scrub contract can't be applied to
 * one platform and missed on the other. The apps spread the result into their
 * `Sentry.init` (instrumentation files on web; the mobile boot file when mobile
 * telemetry wires up).
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
 * Init options with the PII scrubber pre-wired into every Sentry envelope
 * pipeline (the package owns the scrub obligation; app init files stay
 * one-liners). Errors go through `beforeSend`/`beforeBreadcrumb`; tracing is a
 * separate path in v10 — `beforeSendTransaction` (transactions are event-shaped,
 * so `scrubEvent` is reused) and `beforeSendSpan` (the span-shaped scrubber from
 * `./scrub`) are required or span descriptions, full URLs with query strings,
 * and DB statements ship unscrubbed once `tracesSampleRate > 0`. The shape is
 * the shared subset of the Sentry client / server / native option types.
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
