# ADR 0021 — Telemetry: `@repo/telemetry` (Sentry errors + perf, logging sink, agnostic analytics)

**Status:** Accepted (2026-06-04). Realizes the telemetry item deferred in
[ADR 0008](0008-shared-package-boundaries.md) ("new cross-cutting concerns each
get their own package").

## Context

Telemetry was the next deferred cross-cutting concern after i18n
([ADR 0020](0020-i18n-next-intl-use-intl.md)). The existing logger
(`@repo/utils` `createLogger`) is console-backed with no transport seam, so it
cannot reach an error tracker without modification. Requirements gathered:

- **Own Sentry project**, independent of the parent app the skeleton's product
  runs under. **Consent/GDPR is the parent app's responsibility — out of scope.**
- Four signals: **error/crash capture** (Sentry), a **structured-logging sink**
  (route app + `@repo/api` logs into Sentry), **product analytics** (vendor-
  agnostic, no concrete vendor — a no-op default each project replaces), and
  **performance/tracing** (Sentry).
- Cross-platform per the split-UI model (ADR 0006): one contract, thin
  per-platform Sentry bindings. Mobile is dormant, so its seam is built but not
  wired (as with `@repo/auth` and the mocks).

The architectural question was global singleton vs dependency injection for a
concern that must fire at edges the app does not own (React error handling,
runtime `unhandledrejection`, deep low-level logs) — and how that squares with
[ADR 0012](0012-api-client-factory.md), which rejected a module-global API
transport.

## Decision

**Create `@repo/telemetry`**, owning the telemetry contract behind
vendor-agnostic interfaces, with per-platform Sentry bindings
(`@repo/telemetry/web` over `@sentry/nextjs`, `@repo/telemetry/native` over
`@sentry/react-native`). Pattern: **interface + no-op default + single
composition root** ("refined-A"):

1. **Everything depends on a `Telemetry` interface, never on Sentry**, with a
   **no-op default** — swappable (Sentry → anything), fakeable in tests,
   SSR/tree-shake-safe.
2. **One composition root.** `configureTelemetry(adapter)` runs once at app boot;
   an idempotent module holder returns the configured instance (or the no-op) via
   `getTelemetry()`.
3. **Inject explicitly where it is cheap** (the TanStack `QueryCache`/
   `MutationCache` `onError`, error boundaries — all constructed at boot). **Use
   the global facade only at the uncontrollable edges** (the logger's default
   sink, unhandled-error handlers).
4. **Logging sink seam in `@repo/utils`.** `createLogger` gains a `sink?` option
   and `setLoggerSink`; the `LogSink` interface lives in `@repo/utils` (the lower
   leaf) so utils stays dependency-free and `@repo/telemetry` merely implements
   it. `@repo/api` is unchanged — its logs reach Sentry through the configured
   sink, with **no `api → telemetry` edge**.

_Refined (2026-06-04): the `Telemetry` facade is now defined as
`CaptureAdapter & { readonly analytics: Analytics }` and built as
`{ ...capture, analytics }`, so the capture method list is declared once (on
`CaptureAdapter`) instead of being re-typed on `Telemetry` and forwarded
method-by-method in `createTelemetry`. The `createTelemetry` signature is
unchanged; the only behavioural change is that `captureMessage`'s `level` is
now required on the facade too (the optional-`level` default could not survive
the single-declaration collapse and had no callers — every call site already
passes a level explicitly via the logging sink)._

**Why not pure DI (rejected).** Telemetry must fire where no instance can be
threaded (React internals, the runtime, low-level utils). Pure DI therefore
degenerates into DI-for-app-code **plus** a global-for-edges — two mechanisms,
worse DX. The Sentry SDK is itself a global singleton; wrapping it in DI buys
nothing.

**Why this does not reopen ADR 0012.** ADR 0012 rejected a module-global
_API transport_ because transports are request-scoped and benefit from
per-client DI and testability. The telemetry holder is a **process-global facade
resolver**, not a per-request mutable transport — observability is global by
nature (the Sentry SDK installs global handlers regardless). The interface +
no-op default preserve the testability ADR 0012 cared about.

**Analytics.** A vendor-agnostic `Analytics` interface (`trackEvent` / `screen` /
`identify` / `reset`) with a **no-op default**; no concrete vendor is shipped in
this ADR. Each project injects its own adapter via `configureTelemetry`. _Update
(ADR 0028): PostHog is the chosen concrete analytics adapter — the seam is
unchanged; a single PostHog client is shared with `@repo/flags`, initialized once
at app boot and injected into both. Sentry remains errors/perf; PostHog =
analytics (+ flags)._

**DAG (ADR 0008/0011).** New `telemetry` element; rule `telemetry → {utils,
config}`; `telemetry` added to the app allow-list. Nothing depends on
`@repo/telemetry`.

**Config/env.** Sentry vars added to `@repo/config` (web: `NEXT_PUBLIC_SENTRY_DSN`,
`NEXT_PUBLIC_SENTRY_ENVIRONMENT`, `NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE`,
build-time `SENTRY_AUTH_TOKEN`; mobile: `EXPO_PUBLIC_SENTRY_DSN` +
`EXPO_PUBLIC_SENTRY_TRACES_SAMPLE_RATE`, declared now), all optional — a missing
DSN yields a silent no-op, so dev/test run without Sentry. Implementation note:
environment + sample rate are `NEXT_PUBLIC_`-prefixed (not server twins) because
`instrumentation-client.ts` only sees inlined client vars and the server init
reads the same values — one var per concern.

**Mobile deferred.** `native.ts` is implemented; the dormant mobile app is not
wired (no `Sentry.init`), gated with the other mobile work.

## Consequences

- A clean observability seam: one interface, swappable adapters, a no-op default,
  and a single boot-time wiring point. `@repo/api` and other consumers stay
  telemetry-agnostic; their logs and thrown `ApiError`s reach Sentry without new
  dependencies.
- The `@repo/utils` logger becomes transport-capable without taking an SDK
  dependency (interface in utils, impl in telemetry).
- One accepted process-global facade (`getTelemetry()`), justified above and
  distinct from the ADR 0012 transport concern.
- A new package to wire (catalog entry, tsconfig, eslint element, knip entry,
  env) — the bounded per-package cost ADR 0008 accepts.
- Web `next.config.js` gains `withSentryConfig` + instrumentation files; the
  source-map upload needs `SENTRY_AUTH_TOKEN` in CI/release.
- Mobile telemetry is unproven until the native seam is wired and validated on an
  EAS/native build (tracked with the other mobile deferrals).
- **PII scrubbing is mandatory.** The Sentry adapters install a `beforeSend` /
  `beforeBreadcrumb` scrubber (a pure, tested function in the neutral package)
  that strips auth tokens, emails, and Czech rodné číslo before any event leaves
  the device — a cross-package obligation created by the rodné-číslo validator in
  [ADR 0022](0022-typed-search-params-route-dx.md)'s Tier-B sweep
  (`@repo/validators/primitives/cz.ts`).

## Sources

- Sentry for Next.js (App Router, `instrumentation`, `withSentryConfig`):
  <https://docs.sentry.io/platforms/javascript/guides/nextjs/> (verified 2026-06-04).
- Sentry for React Native:
  <https://docs.sentry.io/platforms/react-native/> (verified 2026-06-04).
- [ADR 0008](0008-shared-package-boundaries.md) (package boundaries),
  [ADR 0012](0012-api-client-factory.md) (no module-global transport — the
  distinction drawn above), [ADR 0014](0014-error-handling-exceptions-at-the-data-seam.md)
  (exceptions at the data seam — what gets captured).
