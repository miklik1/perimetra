# Design — `@repo/telemetry` (observability package)

**Date:** 2026-06-04
**Status:** Implemented (refined-A) — web fully wired (instrumentation init,
logger sink in all three Next module graphs, query `onError`, error
boundaries, PII scrubbing verified on the wire against a mock ingest); mobile
booted too — logger sink + live PostHog analytics over the shared client (only
the native Sentry CAPTURE adapter stays deferred until `@sentry/react-native`)
**Decision record:** [ADR 0021](../../adr/0021-telemetry-observability-package.md)

## Goal

Add observability to the skeleton as a dedicated `@repo/telemetry` package
(ADR 0008 reserves one per cross-cutting concern). It owns the **telemetry
contract** — error/crash capture, a structured-logging sink, product analytics,
and performance/tracing — behind vendor-agnostic interfaces, with thin
per-platform Sentry bindings. Mirrors the shape of `@repo/navigation` /
`@repo/i18n` (`web` / `native` subpaths).

Scope confirmed during brainstorming:

- **Errors / crashes** — capture exceptions to **Sentry** (own project, not the
  parent app's), web + mobile.
- **Structured logging → sink** — `@repo/utils`' logger gains a pluggable sink so
  app + `@repo/api` logs become Sentry breadcrumbs/messages.
- **Product analytics** — a **vendor-agnostic `Analytics` interface** with a
  **no-op default**; no concrete vendor shipped (each project drops one in).
- **Performance / tracing** — Sentry `tracesSampleRate` + `withSentryConfig`
  source maps on web; a `startSpan` passthrough on the adapter.

Parent-app relationship: **own Sentry project** (independent of the parent).
Consent/GDPR is handled by the parent app — **not** in scope here.

## Architecture — refined-A: interface + no-op default + single composition root

The chosen pattern is _"DI by default, one accepted global facade, behind an
interface."_ Rationale (full version in ADR 0021):

- Everything depends on a `Telemetry` **interface**, never on Sentry, with a
  **no-op default** — swappable, fakeable in tests, SSR/tree-shake-safe.
- **One composition root:** `configureTelemetry(adapter)` is called once at app
  boot; an idempotent module holder returns the configured instance (or the
  no-op) via `getTelemetry()`.
- **Inject explicitly where cheap** (QueryCache `onError`, error boundaries —
  constructed at boot anyway). **Use the global only at uncontrollable edges**
  (the logger's default sink, unhandled-error handlers).
- The boot-time holder is a _facade resolver_, not a per-request mutable
  transport — which is why it does not reopen
  [ADR 0012](../../adr/0012-api-client-factory.md) (that rejected a request-scoped
  global transport; telemetry is process-global by nature, like the Sentry SDK
  itself).

Why not pure DI (rejected "Approach B"): telemetry must fire at edges the app
does not own (React error handling, runtime `unhandledrejection`, deep low-level
logs). Those always require a module-level reference, so pure DI degenerates into
DI-for-app-code + a global-for-edges = two mechanisms. Refined-A keeps one.

## Package layout

```
packages/telemetry/
  package.json            # exports ".", "./web", "./native"
  src/
    types.ts              # Telemetry, Analytics, CaptureAdapter, TelemetryUser, Breadcrumb
    no-op.ts              # noopCaptureAdapter / noopAnalytics / the no-op Telemetry
    create-telemetry.ts   # createTelemetry({ capture, analytics }) -> Telemetry facade
    registry.ts           # configureTelemetry() / getTelemetry() (idempotent composition root)
    sink.ts               # createLogSink(telemetry): LogSink — bridges @repo/utils Logger -> telemetry
    index.ts              # neutral barrel (NO @sentry/* imports)
    web.ts                # @sentry/nextjs CaptureAdapter
    native.ts             # @sentry/react-native CaptureAdapter (seam built; wiring deferred)
```

Exports (explicit subpaths, like i18n — the platform SDKs differ):

```jsonc
"exports": {
  ".": "./src/index.ts",
  "./web": "./src/web.ts",
  "./native": "./src/native.ts"
}
```

## Public surface

### Neutral contract — `@repo/telemetry` (no SDK imports)

- `Telemetry` interface:
  - `captureException(error: unknown, context?: Record<string, unknown>): void`
  - `captureMessage(message: string, level?: "info" | "warning" | "error", context?): void`
  - `addBreadcrumb(breadcrumb: Breadcrumb): void`
  - `setUser(user: TelemetryUser | null): void`
  - `startSpan<T>(name: string, fn: () => T): T` (passthrough; no-op runs `fn`)
  - `analytics: Analytics`
- `Analytics` interface: `trackEvent(name, props?)`, `screen(name, props?)`,
  `identify(user)`, `reset()`. Default = `noopAnalytics`.
- `CaptureAdapter` — the platform-specific surface the Sentry bindings implement
  (`captureException` / `captureMessage` / `addBreadcrumb` / `setUser` /
  `startSpan` / `flush`). `createTelemetry({ capture, analytics })` composes a
  `CaptureAdapter` + an `Analytics` into the `Telemetry` facade.
- `noopTelemetry` — safe default for SSR, tests, and "before configure".
- `configureTelemetry(telemetry)` / `getTelemetry()` — the composition root; one
  idempotent module holder. `getTelemetry()` returns `noopTelemetry` until
  configured.
- `createLogSink(telemetry): LogSink` — adapts the `@repo/utils` `LogSink`
  interface so `warn`/`error` logs become `captureMessage`/breadcrumbs.

### Platform bindings

- `@repo/telemetry/web` — `createSentryWebAdapter()`: a `CaptureAdapter` over
  the already-initialized `@sentry/nextjs` global. (Sentry `init` itself lives in
  the app's instrumentation files — see Web wiring.)
- `@repo/telemetry/native` — `createSentryNativeAdapter()` over
  `@sentry/react-native`. Built but not wired (mobile dormant).

## `@repo/utils` change (the sink seam)

- `CreateLoggerOptions` gains `sink?: LogSink`; the `LogSink` **interface is
  defined in `@repo/utils`** (the lower leaf), so utils stays dependency-free —
  telemetry merely _implements_ it.
- A `setLoggerSink(sink)` configures the default `logger` singleton's sink once
  at boot. `createLogger` forwards each emitted record to `sink.capture(level,
message, context)` after the level gate.
- Consequence: `@repo/api`'s existing `logger` / `createLogger` usage reaches
  Sentry once the app sets the sink — **no `@repo/api` change, no `api →
telemetry` edge.**

## How the four signals wire (in the app, at the composition root)

1. **Errors/crashes** — `getTelemetry().captureException(err, ctx)` from:
   - web error boundaries `app/error.tsx` + `app/global-error.tsx`;
   - the TanStack `QueryCache` / `MutationCache` `onError` in
     `@repo/api`'s `makeQueryClient` — passed the telemetry instance explicitly
     (DI) so every surfaced `ApiError` is captured with `{ status, path,
fieldErrors }` context. (`makeQueryClient` gains an optional
     `onError?(error)` hook; the app supplies one that calls telemetry — keeps
     `@repo/api` telemetry-agnostic.)
2. **Logging sink** — `setLoggerSink(createLogSink(getTelemetry()))` at boot;
   forwards warn/error (incl. the api debug middleware) as breadcrumbs/messages.
3. **Analytics** — `getTelemetry().analytics.trackEvent(...)` / `screen(...)`;
   no-op by default. Concrete adapter = **PostHog** (ADR 0028), built from a
   single PostHog client shared with `@repo/flags` (initialized once at boot,
   injected into both). Injected via `configureTelemetry`.
4. **Perf/tracing** — Sentry `init({ tracesSampleRate })` in the app
   instrumentation files + `withSentryConfig(nextConfig, …)` for source maps;
   `Telemetry.startSpan` passthrough for manual spans.

## PII scrubbing (Sentry `beforeSend`)

The Sentry adapters (`web.ts` / `native.ts`) install a `beforeSend` /
`beforeBreadcrumb` scrubber that strips PII before any event leaves the device:
auth tokens, emails, and **Czech rodné číslo** (the PII primitive added in the
Tier-B sweep — see `@repo/validators/primitives/cz.ts`). The scrubber is a pure
function in the neutral package (testable, shared by both platforms); the adapter
just wires it into the SDK. This is a cross-package obligation created by shipping
a rodné-číslo validator — a validated-but-rejected value must never reach the
error tracker.

## Web wiring (apps/web)

- `instrumentation-client.ts` + `instrumentation.ts` (server) call
  `Sentry.init(buildSentryOptions({ dsn, environment, tracesSampleRate }))` from
  `@sentry/nextjs` — the options builder lives in `@repo/telemetry/web` so the
  scrubber wiring is package-owned and the app files stay one-liners.
- `lib/telemetry-boot.ts` (idempotent boot module): build the adapter
  (`createSentryWebAdapter()`), `const telemetry = createTelemetry({ capture })`,
  `configureTelemetry(telemetry)`, `setLoggerSink(createLogSink())`. _Called
  once per JS RUNTIME from the instrumentation files — `instrumentation.ts`
  `register()` (each server runtime) and `instrumentation-client.ts` (browser).
  The registry and the logger sink live on `globalThis` symbol carriers (the
  `@repo/api` api-log-store pattern), so one boot covers ALL of Next's
  separately-bundled module graphs in that runtime; the earlier per-graph
  module state stranded un-booted graphs' logs on the no-op (caught by runtime
  verification, fixed by the carrier). The sink resolves `getTelemetry()` per
  capture, so boot order is irrelevant._
- `next.config.js` wrapped with `withSentryConfig` (source-map upload via
  `SENTRY_AUTH_TOKEN`).
- Error boundaries (`app/error.tsx`, `app/global-error.tsx`) call
  `captureException`.

## Mobile (apps/mobile) — deferred

`native.ts` (`@sentry/react-native` adapter) is implemented so the seam exists,
but the dormant mobile app is **not** wired (no `Sentry.init`, no boot config) —
consistent with how `@repo/auth` and the mocks treat mobile. Wiring is a
follow-up gated with the other mobile work (EAS/native build).

## Dependency DAG (ADR 0008 / 0011)

- New element: `{ type: "telemetry", pattern: "packages/telemetry/**" }`.
- Rule: `telemetry → {telemetry, utils, config}`.
- Add `telemetry` to the app allow-list.
- Nothing depends on `@repo/telemetry`; `@repo/api` stays `→ {validators, utils,
config}` (errors reach telemetry via the utils sink + the app's `onError`
  hook, never an import).

## Config / env (`@repo/config`)

Add to the env schemas + `turbo.json` globalEnv:

- web: `NEXT_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_ENVIRONMENT`,
  `NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE`, build-time `SENTRY_AUTH_TOKEN`
  (source maps; server schema), all optional so dev/test run without Sentry.
  _Environment + rate are `NEXT_PUBLIC_`-prefixed (not server twins):
`instrumentation-client.ts` only sees inlined client vars, and the server
  init reads the same values — one var per concern.\_
- mobile: `EXPO_PUBLIC_SENTRY_DSN`, `EXPO_PUBLIC_SENTRY_TRACES_SAMPLE_RATE`
  (declared now, consumed when mobile is wired).

DSN absent → adapters init to no-op; telemetry stays silent (dev/test default).

## Testing (ADR 0005 two-runner split)

- **Package (Vitest):** `createTelemetry` routes calls to a fake `CaptureAdapter`
  (assert captureException/Message/breadcrumb/setUser + analytics calls);
  `createLogSink` maps log levels correctly; `getTelemetry()` returns no-op
  before configure and the instance after; `configureTelemetry` is idempotent.
- **`@repo/utils` (Vitest):** the logger forwards to an injected sink after the
  level gate and not below it.
- **Web (Vitest):** the `makeQueryClient` `onError` hook fires telemetry capture
  on a thrown `ApiError` with the right context.

## Out of scope / deferred

- Mobile Sentry wiring (seam only) — gated with mobile work.
- Concrete analytics vendor — agnostic seam + no-op only; per-project choice.
- Consent/GDPR gating — owned by the parent app.
- Session replay, profiling, custom dashboards — project-level Sentry config.

## Catalog of files to create / change (for the plan)

**New (`packages/telemetry/`):** `package.json`, `tsconfig.json`,
`vitest.config.ts`, `src/{types,no-op,create-telemetry,registry,sink,index,web,native}.ts`,
plus tests.

**Changed:**

- `packages/utils/src/logger.ts` (+ `index.ts`, tests) — `LogSink` interface,
  `sink` option, `setLoggerSink`.
- `packages/api/src/**` — `makeQueryClient` gains an optional `onError` hook
  (telemetry-agnostic).
- `tooling/eslint/base.js` — telemetry element + rule + app allowance.
- `packages/config/src/env/{web,mobile}.ts` (+ tests) — Sentry env vars.
- `turbo.json` — globalEnv additions.
- `pnpm-workspace.yaml` — catalog entries (`@sentry/nextjs`;
  `@sentry/react-native` in the expo56 set, SDK-checked).
- `apps/web/` — `instrumentation.ts`, `instrumentation-client.ts`,
  `next.config.js` (`withSentryConfig`), `app/providers.tsx` boot wiring,
  `app/error.tsx` + `app/global-error.tsx` capture.
- `knip.json` — `packages/telemetry` workspace entry.
- `docs/adr/0021-*.md`, `docs/adr/README.md`, `ARCHITECTURE.md`.
