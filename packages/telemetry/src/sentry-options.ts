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
 *
 * COMPOSE ALL FOUR. If an app WRAPS a hook to add app-specific redaction — the
 * usual reason being a capability token in a URL PATH, which this scrubber keeps
 * by design and which matches no value shape — it must wrap ALL FOUR of the hooks
 * this builder wires: `beforeSend`, `beforeBreadcrumb`, `beforeSendTransaction`
 * and `beforeSendSpan`. Re-specifying a subset is well-typed and silent, because
 * every Sentry hook is optional: the hooks left out keep the bare scrubber while
 * the others gain the app redaction, so the secret still ships on whichever
 * envelope was skipped. Outgoing-request breadcrumbs are the easy one to forget —
 * Sentry adds them by default, WITH the pathname. This has already leaked once in
 * a repo derived from this skeleton lineage. Note the claim here is about the
 * four envelope paths this builder wires, not about the scrubber covering every
 * field of them.
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
