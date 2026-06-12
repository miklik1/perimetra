# @repo/telemetry

Observability: a vendor-agnostic `Telemetry` facade (error/crash capture, breadcrumbs, `setUser`, `startSpan`) plus an `Analytics` seam, with a no-op default, a boot-time composition root, a logger-sink bridge, and PII scrubbing (ADR 0021).

## Exports

Neutral barrel (`@repo/telemetry`) — no `@sentry/*` import:

- Types: `Telemetry` (= `CaptureAdapter & { analytics }`), `Analytics`, `CaptureAdapter`, `TelemetryUser`, `TelemetryLevel`, `Breadcrumb`.
- `noopTelemetry`, `noopAnalytics`, `noopCaptureAdapter` — silent defaults.
- `createTelemetry(opts)` (`CreateTelemetryOptions`) — compose a `CaptureAdapter` + optional `Analytics` into the facade.
- `configureTelemetry`, `getTelemetry`, `resetTelemetry` — the `globalThis`-carrier composition root (first-wins).
- `createLogSink` — bridge `@repo/utils`' logger into the facade (no `api → telemetry` edge).
- `scrubEvent`, `scrubBreadcrumb`, `redactString` — PII scrubbing.
- `buildSentryOptions` (`SentryInitConfig`) — SDK-free Sentry option builder (scrubber pre-wired), spread into `Sentry.init` in the app.
- `createPosthogAnalytics` (`PosthogAnalyticsClient`) — SDK-free `Analytics` over the PostHog client shared with `@repo/flags` (ADR 0028).

`@repo/telemetry/web` (re-exports the barrel): `createSentryWebAdapter()` over `@sentry/nextjs`.
`@repo/telemetry/native` (re-exports the barrel): `createSentryNativeAdapter()` over `@sentry/react-native` (seam-built; mobile capture wiring deferred).

## Usage

Boot the facade once per runtime (mirrors `apps/web/lib/telemetry-boot.ts`):

```ts
import {
  configureTelemetry,
  createLogSink,
  createTelemetry,
  noopCaptureAdapter,
  type Analytics,
} from "@repo/telemetry";
import { createSentryWebAdapter } from "@repo/telemetry/web";
import { setLoggerSink } from "@repo/utils";

configureTelemetry(
  createTelemetry({
    capture: hasDsn ? createSentryWebAdapter() : noopCaptureAdapter,
    analytics, // createPosthogAnalytics(posthog), passed from instrumentation-client.ts
  }),
);
setLoggerSink(createLogSink());
```

Capture surfacing errors via the API `onError` seam: `getTelemetry().captureException(error, errorContext(error))` (see `apps/web/app/providers.tsx`).

## Decisions

- [ADR 0021](../../docs/adr/0021-telemetry-observability-package.md) — vendor-agnostic interface + no-op + composition root; Sentry bindings; logger sink; agnostic analytics seam.
- [ADR 0028](../../docs/adr/0028-feature-flags-posthog.md) — analytics adapter wraps the ONE PostHog client `@repo/flags` boots (one client, two seams).
