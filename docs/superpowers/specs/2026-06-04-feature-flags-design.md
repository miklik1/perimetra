# Design — `@repo/flags` (feature flags, PostHog-backed)

**Date:** 2026-06-04
**Status:** Implemented (2026-06-04) — web fully wired (RSC bootstrap +
provider init verified on the wire); mobile LIVE too — the pure-JS
`posthog-react-native` client backs `FlagsProvider`, booted in `app/_layout.tsx`
**Decision record:** [ADR 0028](../../adr/0028-feature-flags-posthog.md)

## Goal

A thin, vendor-agnostic feature-flag seam with **PostHog** as the reference
adapter, mirroring `@repo/telemetry` / `@repo/i18n` (interface + default +
composition root + per-platform bindings). App code uses typed `useFlag` /
`getFlag`, never the PostHog SDK.

## Package layout

```
packages/flags/
  package.json            # exports ".", "./web", "./web/server", "./native"
  src/
    registry.ts           # FLAGS const (key -> default/type), FlagKey, FlagValue
    types.ts              # Flags interface, FlagsAdapter
    static.ts             # static/default adapter (registry defaults) + no-op
    create-flags.ts       # createFlags(adapter) + configureFlags/getFlags
    index.ts              # neutral barrel (no posthog imports)
    web.tsx               # client binding: FlagsProvider + useFlag/useFlagValue (posthog-js adapter)
    web.server.ts         # RSC binding: getFlag/getAllFlags (posthog-node adapter) + bootstrap export
    native.ts             # posthog-react-native adapter (seam built; wiring deferred)
    posthog.ts            # SDK-free vendor constants (EU host default)
```

## Public surface

### Neutral contract — `@repo/flags`

```ts
export const FLAGS = {
  "example-flag": { default: false },
  // "new-checkout": { default: false },
  // "ranking-algo": { default: "control" as "control" | "v2" },  // multivariate
} as const;

export type FlagKey = keyof typeof FLAGS;

export interface Flags {
  isEnabled(key: FlagKey): boolean;
  getValue<K extends FlagKey>(key: K): FlagValue<K>; // variant/payload
  getAll(): Record<FlagKey, unknown>;
}

export interface FlagsAdapter extends Flags {
  /** Optional: seed for client bootstrap (server adapter). */
  bootstrapData?(): Record<string, unknown>;
}

export function createStaticFlags(): Flags; // registry defaults; SSR/test/default
export function configureFlags(adapter: Flags): void; // composition root (idempotent)
export function getFlags(): Flags; // static default until configured
```

### Bindings

- `@repo/flags/web` (client): `FlagsProvider` (wraps a `posthog-js`-backed
  adapter, seeded by server `bootstrap`), `useFlag(key)`, `useFlagValue(key)`.
- `@repo/flags/web/server` (RSC): `getFlag(key)` / `getAllFlags()` over a
  `posthog-node` adapter evaluating for the current user; `getBootstrap()` to
  pass server-evaluated flags into the client provider (no flash).
- `@repo/flags/native`: `posthog-react-native` adapter + the same hook surface.
  **Deferred** wiring (mobile dormant).

## Evaluation model

- **RSC:** `getFlag` evaluates server-side for the current user (distinctId from
  the auth cookie, injected — see below). First render is correct, no flash.
- **Client:** `FlagsProvider` initializes `posthog-js` with `bootstrap:
{ featureFlags }` from the server evaluation, then live-updates.
- **Mobile:** `posthog-react-native` loads flags on init (deferred).

## DistinctId & the shared PostHog client (composition, no new edges)

- `@repo/flags` never imports `@repo/auth`. The **distinctId is injected** at
  configure time (the app passes the current user id / a getter from
  `@repo/auth`), so the DAG stays `flags → {utils, config}`.
- The app initializes **one** PostHog client at boot and injects it into **both**
  the `@repo/telemetry` analytics adapter (ADR 0021) and the `@repo/flags`
  adapter. One SDK instance, one `identify`, two seams. (Web client: `posthog-js`;
  server: `posthog-node`; mobile: `posthog-react-native`.)

## Web wiring (apps/web)

- Boot (instrumentation-client): the `posthog-js` module SINGLETON backs both
  the telemetry analytics adapter and the flags client adapter
  (`configureFlags`) — carriers populated before init; the `posthog.init`
  call itself runs in `FlagsProvider`, the only place this request's
  server-evaluated bootstrap exists (PostHog's App Router pattern).
- RSC: `getFlag` uses a `posthog-node` client (built once per node runtime in
  `instrumentation.ts`); the root layout passes `getBootstrap()` into the
  client `FlagsProvider`. Identity rides PostHog's own cookie
  (`readPostHogCookie`, incl. `isIdentified`); first visits mint the id the
  bootstrap hands the client.
- `app/providers.tsx`: mount `FlagsProvider` (alongside Api/Auth/Theme) +
  `AnalyticsIdentity` (auth → identify/setUser/reset bridge).

## Config / env (`@repo/config`)

Add (all optional → static-default adapter when absent):

- web: `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST` (EU cloud),
  `POSTHOG_PERSONAL_API_KEY` (optional, server local evaluation — avoids a
  per-request call).
- mobile: `EXPO_PUBLIC_POSTHOG_KEY`, `EXPO_PUBLIC_POSTHOG_HOST`.

`turbo.json` globalEnv updated.

## Consent

Capturing respects the parent app's consent (`opt_out_capturing_by_default`
until the parent signals consent); **flag evaluation is functional and runs
regardless.** Consent ownership stays with the parent app (ADR 0021).

## DAG / boundaries

New `flags` element; rule `flags → {flags, utils, config}`; add `flags` to the
app allow-list. No `flags → auth` (distinctId injected). Nothing depends on
`@repo/flags`.

## Telemetry cross-update (ADR 0021)

PostHog becomes the concrete **analytics** adapter behind telemetry's existing
seam (no decision reversal). The telemetry spec/ADR note this and the shared
client. `@repo/telemetry` gains a PostHog analytics adapter alongside its Sentry
capture adapter (Sentry = errors/perf; PostHog = analytics + flags).

## Testing (Vitest)

- `createStaticFlags` returns registry defaults; `configureFlags`/`getFlags`
  idempotent; static before configure.
- A fake adapter drives `isEnabled`/`getValue` typing + variant payloads.
- Web: `useFlag` reads provider value; server bootstrap seeds client (no flash)
  — asserted with a fake PostHog client.

## Out of scope / deferred

- Mobile PostHog wiring (seam only).
- Experiments/A-B analysis dashboards (PostHog product config, not code).
- Local-eval tuning (`POSTHOG_PERSONAL_API_KEY`) — supported, optional.

## Files (for the plan)

**New:** `packages/flags/**` (+ tests); `apps/web` boot/provider wiring; env in
`@repo/config`.

**Changed:** `tooling/eslint/base.js` (flags element + rule + app allow),
`knip.json`, `pnpm-workspace.yaml` (catalog: `posthog-js`, `posthog-node`;
`posthog-react-native` in expo56), `turbo.json` (globalEnv), `@repo/telemetry`
(PostHog analytics adapter + spec/ADR note), `apps/web/app/providers.tsx`;
`docs/adr/0028-*.md`, `docs/adr/README.md`, `ARCHITECTURE.md`.
