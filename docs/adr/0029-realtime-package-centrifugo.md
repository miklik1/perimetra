# ADR 0029 — Realtime: `@repo/realtime` seam with a Centrifugo adapter

**Status:** Accepted (2026-06-10). Realizes a new cross-cutting concern under
the [ADR 0008](0008-shared-package-boundaries.md) rule (each concern gets its
own package + ADR). Mirrors the seam pattern of
[ADR 0021](0021-telemetry-observability-package.md) (telemetry) and
[ADR 0028](0028-feature-flags-posthog.md) (flags).

## Context

The first product migrating onto this skeleton (primat-plus) streams
server-push events over **Centrifugo** (WebSocket): background-job progress
(AI generation), chat message streaming, with **history recovery** via
stream positions (`offset`/`epoch`) so a dropped connection can replay missed
events — and a "stream lost" signal when it can't, which the app must treat as
stale state. Its current implementation is a proven but app-entangled
singleton (job-store writes, terminal-event auto-unsubscribe, Czech toasts
inside the transport layer).

The skeleton had no realtime seam. Realtime is transport, like `@repo/api` —
vendor SDKs must not leak into app/domain code, and tests need a deterministic
fake. The REST seam also can't host it: WebSockets bypass the BFF
(ADR 0018) — the realtime endpoint is exposed to the client directly.

## Decision

**Create `@repo/realtime`** — a thin, vendor-agnostic realtime seam with
Centrifugo as the reference adapter. **Transport only**: connection lifecycle,
one-subscription-per-channel, publications with optional stream positions, and
recovery outcomes. Domain semantics (what a channel means, how an event
mutates a store, when to stop listening) stay in the app.

- **Contract** (`RealtimeClient`): `connect`/`disconnect`, `getState` +
  `onStateChange` (`disconnected | connecting | connected`),
  `subscribe(channel, handlers, { since? })` → `RealtimeSubscription`, and
  `setToken` for auth rotation. `subscribe` is legal in any connection state —
  adapters queue and activate on (re)connect, so callers never order calls
  around the socket. One logical subscription per channel; duplicate
  `subscribe` throws (fan-out belongs above the seam).
- **Recovery is first-class.** `SubscribeOptions.since` resumes from a stored
  `StreamPosition`; `SubscribedContext` reports
  `wasRecovering`/`recovered`/`position`, and publications carry their
  position so the app can persist it. `wasRecovering && !recovered` = stream
  lost — the app's signal to mark in-flight state stale.
- **No-op default + in-memory mock.** `createNoopRealtime()` (keyless/dev) and
  `createMockRealtime()` (deterministic test driver: `emit`, `emitError`,
  `setState`, scriptable recovery outcomes) live on the neutral barrel — no
  vendor SDK import.
- **Centrifugo adapter** behind `@repo/realtime/centrifuge`
  (`createCentrifugeRealtime`), over the `centrifuge` npm client — pure JS
  (WebSocket transport), the **same package on web and RN**, so it lives in
  the default catalog, not the expo56 set. The SDK's own subscription
  buffering and reconnect backoff satisfy the contract's queueing rule; the
  adapter adds channel bookkeeping, epoch tracking for publication positions,
  and full teardown (`removeSubscription`) on unsubscribe.
- **React surface** behind `@repo/realtime/react`: `useChannel` (lifetime
  subscription, `null` channel skips, handlers in a ref so inline closures
  don't churn the subscription) and `useConnectionState`
  (`useSyncExternalStore`).
- **Token is injected, not imported.** `getToken` (connect + SDK-driven
  refresh) and `setToken` (rotation push) are wired by the app from
  `@repo/auth` at the composition root — **no `realtime → auth` edge**, the
  same rule as flags' distinctId (ADR 0028).
- **DAG:** `realtime → {utils, config}`; nothing depends on it except the
  apps. Enforced in `tooling/eslint/base.js` (ADR 0011).

## Consequences

- App code subscribes through one typed contract; Centrifugo is swappable for
  any channel-based vendor (Pusher/Ably/raw WS) by writing one adapter.
- Tests script realtime flows synchronously (mock adapter) — no sockets, no
  timers, no flake.
- The realtime URL is a **client-visible** env (`NEXT_PUBLIC_*` /
  `EXPO_PUBLIC_*`, added per-project in `@repo/config` when wired): WebSockets
  don't traverse the BFF, a documented exception to ADR 0018's
  origin-hiding.
- The migrating app must keep its domain logic (job stores, auto-unsubscribe
  policies, user-facing failure toasts) app-side — the seam deliberately has
  no opinion, which is what makes it reusable for chat, presence, or live
  queries in future projects.
- No skeleton app wires it yet (no demo backend) — like the OpenAPI seam
  (ADR 0019), it ships consumer-ready with adapter + mock + tests.

## Sources

- Centrifugo client SDK (subscriptions, history recovery `since`/`offset`/
  `epoch`, token refresh `getToken`):
  <https://centrifugal.dev/docs/transports/client_api> (verified 2026-06-10).
- `centrifuge` npm package (browser + Node + React Native):
  <https://github.com/centrifugal/centrifuge-js> (verified 2026-06-10).
- The proven reference implementation being formalized:
  `primat-plus/src/lib/centrifuge/manager.ts` (job streaming + recovery in
  production).
