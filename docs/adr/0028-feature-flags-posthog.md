# ADR 0028 — Feature flags: `@repo/flags` seam with a PostHog adapter; shared PostHog client with telemetry

**Status:** Accepted (2026-06-04). Realizes the feature-flags item deferred in
[ADR 0008](0008-shared-package-boundaries.md). Relates to
[ADR 0021](0021-telemetry-observability-package.md) (analytics seam → same vendor).

## Context

Feature flags was the last deferred cross-cutting concern. The product will adopt
**PostHog**, which provides product analytics, session replay, **feature flags**,
experiments, and surveys, with an **EU cloud** (data residency for the CZ
context). PostHog therefore lands in two seams already designed:

- the **analytics** adapter behind `@repo/telemetry`'s vendor-agnostic seam
  (ADR 0021, which shipped a no-op default and no concrete vendor), and
- **feature flags**, the subject of this ADR.

The web app is RSC-first (ADR 0006), so flags must evaluate on the server to
avoid a flag-flash on first render.

## Decision

**Create `@repo/flags`** — a thin, vendor-agnostic flags seam with PostHog as the
reference adapter — mirroring the telemetry pattern (interface + default +
composition root + per-platform bindings). PostHog the _SDK_ is never called
directly from app code.

- **Typed registry.** A const `FLAGS` declares each flag key + default (and
  variant/payload type); `FlagKey = keyof typeof FLAGS`. `isEnabled(key)` /
  `getValue(key)` are typed against it — no stringly-typed keys.
- **`Flags` interface + static default.** `isEnabled(key): boolean`,
  `getValue<T>(key): T`, `getAll()`. The default adapter returns registry
  defaults — SSR-safe, test-safe, and the "before load" value.
- **Composition root** (`configureFlags` / `getFlags`) + a React surface
  (`FlagsProvider`, `useFlag`, `useFlagValue`) and an RSC `getFlag` — same shape
  as i18n/telemetry (`web` / `web/server` / `native`).
- **Per-platform PostHog adapters:** web RSC via `posthog-node` (server-side
  evaluation for the current user), web client via `posthog-js`, mobile via
  `posthog-react-native`. **RSC → client bootstrap:** the server-evaluated flags
  seed `posthog-js` via its `bootstrap` option, so the client starts with the
  correct values (no flash) and then live-updates.
- **DistinctId is injected, not imported.** The adapter takes the current user id
  (from `@repo/auth`) at configure time, so `@repo/flags` stays `→ {utils,
config}` with **no `flags → auth` edge** (the app wires auth's user into both
  flags and telemetry `setUser`).
- **One shared PostHog client.** The app initializes PostHog once at boot
  (`posthog-js` / `posthog-react-native` / `posthog-node`) and injects the same
  instance into **both** the `@repo/telemetry` analytics adapter and the
  `@repo/flags` adapter. Two packages, one responsibility each (ADR 0008), one
  SDK instance — composed at the app, no cross-package edge.
- **Consent.** Capturing/analytics respects the parent app's consent (PostHog
  `opt_out_capturing_by_default` until the parent signals consent); flag
  _evaluation_ is functional and runs regardless. Consent remains the parent
  app's responsibility (ADR 0021).

This does **not** reverse ADR 0021's analytics decision — the seam stays; PostHog
is simply the concrete adapter now chosen for it.

## Consequences

- Typed, RSC-correct flags with a swappable adapter; the app reads
  `useFlag('x')` / server `getFlag('x')`, never the PostHog SDK.
- PostHog consolidates analytics + flags (+ replay) on one EU-hosted vendor and
  one client instance, injected into two clean seams.
- New env (`@repo/config`): `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST`
  (EU), optional `POSTHOG_PERSONAL_API_KEY` (server local evaluation),
  `EXPO_PUBLIC_POSTHOG_KEY` — all optional; absent → the static-default adapter,
  so dev/test run with registry defaults.
- DAG gains a `flags` element `→ {utils, config}`; nothing depends on it.
- Mobile adapter is built but **wiring deferred** (dormant app), like the other
  mobile seams.
- Server-side evaluation adds a per-request PostHog call unless local evaluation
  (`POSTHOG_PERSONAL_API_KEY`) is configured — a documented tradeoff.

## Sources

- PostHog feature flags (incl. Node server-side eval + `bootstrap` for no-flash):
  <https://posthog.com/docs/feature-flags> (verified 2026-06-04).
- PostHog libraries `posthog-js` / `posthog-node` / `posthog-react-native`:
  <https://posthog.com/docs/libraries> (verified 2026-06-04).
- [ADR 0008](0008-shared-package-boundaries.md) (own package per concern),
  [ADR 0021](0021-telemetry-observability-package.md) (analytics seam / shared
  vendor), [ADR 0006](0006-split-ui-web-dom-mobile-rn.md) (RSC-first → server
  flag eval), [ADR 0016](0016-auth-jwt-refresh-package.md) (distinctId source).
