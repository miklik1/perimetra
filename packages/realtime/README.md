# @repo/realtime

Realtime/WebSocket seam: a vendor-agnostic `RealtimeClient` contract (channel subscriptions, connection state, stream-position history recovery) + a no-op default + an in-memory mock for tests + a Centrifugo adapter (ADR 0029). Transport only — domain semantics (what a channel means, how an event mutates a store) stay in the app.

**One vendor subscription per channel, any number of consumers on it.** A broadcast channel (`org:<id>`) is normally read by several unrelated components; the adapters fan one subscription out to all of them and refcount the consumers (ADR 1039).

## Exports

Neutral barrel (`@repo/realtime`) — no vendor SDK import:

- `RealtimeClient`, `RealtimeSubscription`, `SubscriptionHandlers`, `RealtimePublication`, `SubscribedContext`, `SubscribedOrigin`, `SubscribeOptions`, `ConnectionState`, `StreamPosition` — the contract.
- `RealtimeContractError` (`RealtimeContractErrorCode`) — thrown for the two cases the fan-out deliberately refuses to guess about. Branch on `error.code`, never on the message.
- `createNoopRealtime` — permanently-disconnected default (keyless/dev runs, tests that don't care).
- `createMockRealtime` (`MockRealtime`, `MockRealtimeOptions`) — deterministic in-memory adapter; tests drive it with `emit` / `emitError` / `setState`, script recovery outcomes, and inspect fan-out with `activeChannels` / `openChannels` / `consumerCount` / `openCount`.

`@repo/realtime/centrifuge` (optional `centrifuge` peer): `createCentrifugeRealtime` (`CentrifugeRealtimeConfig`) — the Centrifugo adapter; pure JS, same client on web and RN. Optional `getSubscriptionToken` supplies a per-channel subscription JWT for protected namespaces.

`@repo/realtime/react` (`"use client"`, re-exports the contract): `useChannel` (subscribe for a component's lifetime, `null` channel skips), `useConnectionState`.

The fan-out registry itself is **internal** (`src/fanout.ts`, not on the `exports` map). Every adapter composes it; app code never touches it, and an app-side adapter that needs fan-out must compose `createCentrifugeRealtime` rather than hand-roll one.

## Usage

App composition root (token injected — no `realtime → auth` edge, the ADR 0028 rule):

```ts
import { createCentrifugeRealtime } from "@repo/realtime/centrifuge";

const realtime = createCentrifugeRealtime({
  url: env.NEXT_PUBLIC_REALTIME_URL,
  getToken: () => tokenManager.getToken(),
});
realtime.connect();
```

Listen to a job channel in a component:

```tsx
import { useChannel } from "@repo/realtime/react";

useChannel<JobEvent>(realtime, job ? `job:${job.id}` : null, {
  onPublication: ({ data, position }) => updateJob(data, position),
  onSubscribed: ({ wasRecovering, recovered }) => {
    if (wasRecovering && !recovered) markJobStale(job.id); // stream lost
  },
});
```

Two components on the same broadcast channel is a supported, ordinary case — no coordination needed:

```tsx
useChannel<OrgEvent>(realtime, `org:${orgId}`, { onPublication: refreshNavCounts });
// …elsewhere in the tree, same channel, same client:
useChannel<OrgEvent>(realtime, `org:${orgId}`, { onPublication: refreshDashboard });
```

In tests, swap in the mock:

```ts
const realtime = createMockRealtime();
realtime.emit("job:1", { type: "progress", value: 50 });
```

## Contract rules

- **One vendor subscription per channel; consumers are refcounted.** Subscribing to a live channel registers an additional consumer and returns its own handle; every consumer receives every publication, error and (re)subscribe.
- `SubscribedContext.origin` says which arrival this is: `"opened"` (the vendor really (re)subscribed — everyone on the channel gets it) or `"joined"` (synthesised for a consumer that attached to an already-open channel; always `wasRecovering: false, recovered: false`, because the joiner attempted no recovery).
- **Teardown is deferred by one microtask.** The vendor subscription closes only after the last consumer leaves _and_ nobody has re-subscribed by the end of the tick — React runs every cleanup and then every setup in one flush, so a StrictMode remount or a sole-consumer swap must not churn the socket. In tests, `await Promise.resolve()` to cross the window.
- **`unsubscribe()` exactly once per handle.** A second call throws `RealtimeContractError` with `code: "double-release"`. `unsubscribe()` after `disconnect()` is deliberately silent — React tears the provider down before its children.
- **Two live consumers cannot disagree about `since`.** A second `since` that differs from the one the channel was opened with throws `code: "since-conflict"`; give that consumer its own channel, or drop its `since` and join the live stream. A `since` arriving when nobody is left on the channel re-opens it at the new position instead.
- **The same publication object is handed to every consumer** — no clone, for cost. Consumers must not mutate it or its `data`. Documented, not enforced.
- `subscribe` may be called in any connection state; adapters queue and activate on (re)connect.
- A failed recovery (`wasRecovering && !recovered`) means the stream was lost — the app must treat in-flight state as stale.
