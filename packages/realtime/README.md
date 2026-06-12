# @repo/realtime

Realtime/WebSocket seam: a vendor-agnostic `RealtimeClient` contract (channel subscriptions, connection state, stream-position history recovery) + a no-op default + an in-memory mock for tests + a Centrifugo adapter (ADR 0029). Transport only — domain semantics (what a channel means, how an event mutates a store) stay in the app.

## Exports

Neutral barrel (`@repo/realtime`) — no vendor SDK import:

- `RealtimeClient`, `RealtimeSubscription`, `SubscriptionHandlers`, `RealtimePublication`, `SubscribedContext`, `SubscribeOptions`, `ConnectionState`, `StreamPosition` — the contract.
- `createNoopRealtime` — permanently-disconnected default (keyless/dev runs, tests that don't care).
- `createMockRealtime` (`MockRealtime`, `MockRealtimeOptions`) — deterministic in-memory adapter; tests drive it with `emit` / `emitError` / `setState` and script recovery outcomes.

`@repo/realtime/centrifuge` (optional `centrifuge` peer): `createCentrifugeRealtime` (`CentrifugeRealtimeConfig`) — the Centrifugo adapter; pure JS, same client on web and RN.

`@repo/realtime/react` (`"use client"`, re-exports the contract): `useChannel` (subscribe for a component's lifetime, `null` channel skips), `useConnectionState`.

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

In tests, swap in the mock:

```ts
const realtime = createMockRealtime();
realtime.emit("job:1", { type: "progress", value: 50 });
```

## Contract rules

- One logical subscription per channel — `subscribe` on an active channel throws; fan-out belongs above this seam.
- `subscribe` may be called in any connection state; adapters queue and activate on (re)connect.
- A failed recovery (`wasRecovering && !recovered`) means the stream was lost — the app must treat in-flight state as stale.
