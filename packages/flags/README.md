# @repo/flags

Feature flags: a typed flag registry + vendor-agnostic `Flags` contract + static default + a PostHog adapter — RSC server eval with client bootstrap for no-flash, plus web and native React surfaces (ADR 0028).

## Exports

Neutral barrel (`@repo/flags`) — no `posthog-*` import:

- `FLAGS` — the typed flag registry (every flag + its default); `FlagKey`, `FlagValue<K>` types.
- `Flags`, `FlagsBootstrap` — the sync contract + the server-evaluated client seed.
- `createStaticFlags`, `staticDefaults` — registry-default adapter.
- `configureFlags`, `getFlags`, `resetFlags` — the sync composition root (native non-React read path).
- `POSTHOG_EU_HOST` — default EU cloud host.

`@repo/flags/web` (`"use client"`, re-exports the barrel): `createPosthogClientAdapter`, `FlagsProvider` (`FlagsProviderProps`), `useFlag`, `useFlagValue`.

`@repo/flags/web/server` (RSC, async — re-exports the barrel): `configureServerFlags` (`ServerFlagsConfig`), `resetServerFlags`, `ServerFlagsIdentity`, `getFlag`, `getAllFlags`, `getBootstrap`.

`@repo/flags/native` (React surface — re-exports the barrel): `createPosthogNativeAdapter`, `FlagsProvider` (`NativeFlagsProviderProps`), `useFlag`, `useFlagValue`.

## Usage

Gate a client leaf on a flag (mirrors `apps/web/app/users-infinite-list.tsx`):

```tsx
import { useFlag } from "@repo/flags/web";

const enabled = useFlag("example-flag");
if (!enabled) return null;
```

The provider (with the RSC bootstrap threaded from the layout) is mounted in `apps/web/app/providers.tsx`; server eval wiring lives in `apps/web/lib/server-flags.ts`.

## Decisions

- [ADR 0028](../../docs/adr/0028-feature-flags-posthog.md) — `@repo/flags` seam + PostHog adapter (RSC bootstrap); PostHog client shared with `@repo/telemetry` analytics.
- [ADR 0021](../../docs/adr/0021-telemetry-observability-package.md) — the shared PostHog client backs both flags and the analytics seam.
- [ADR 0008](../../docs/adr/0008-shared-package-boundaries.md) — DAG kept at `flags → {utils}`; distinctId injected (no `flags → auth` edge).

## Adding a flag

Declare it in `FLAGS` in `src/registry.ts` with its default — the default defines the flag's "off" state once and types `FlagValue<K>`.
