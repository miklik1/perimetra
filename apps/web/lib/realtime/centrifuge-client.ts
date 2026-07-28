import type { RealtimeClient } from "@repo/realtime";
import { createCentrifugeRealtime } from "@repo/realtime/centrifuge";

/**
 * App-side wiring for the Centrifugo adapter (ADR 0029). This file used to be a
 * near-copy of `@repo/realtime/centrifuge` because the package adapter had no
 * per-channel `getSubscriptionToken` — the local Centrifugo namespaces (`user`,
 * `org`) refuse a client-side subscribe without a subscription JWT, which the
 * API mints at `POST /v1/realtime/subscribe-token`.
 *
 * That copy is gone. The hook moved upstream into `CentrifugeRealtimeConfig`,
 * so this file is now nothing but the app's own config shape mapped onto the
 * package's. That matters beyond deduplication: **channel fan-out lives in the
 * package's internal registry** (one vendor subscription per channel, N
 * consumers on it, refcounted), and the registry is deliberately not exported.
 * A hand-rolled app adapter therefore cannot have fan-out at all — it would
 * silently reintroduce the "second consumer of a shared channel gets nothing"
 * class the registry exists to kill. Composing the package adapter is the only
 * way an app-side adapter can be correct.
 *
 * The per-channel token stays correct for free: there is still exactly ONE
 * vendor subscription per channel however many components subscribe, so a
 * subscription JWT is minted once per channel, not once per consumer.
 *
 * Components stay on the neutral interface (`useChannel` / `useConnectionState`
 * from `@repo/realtime/react`) — only this composition-root file names the
 * adapter at all.
 */
export interface WebCentrifugeConfig {
  /** WebSocket endpoint, e.g. `ws://localhost:8000/connection/websocket`. */
  url: string;
  /** Connection JWT source — `GET /v1/realtime/token`. Called on connect and expiry. */
  getToken: () => Promise<string | null>;
  /** Subscription JWT source — `POST /v1/realtime/subscribe-token` per channel. */
  getSubscriptionToken: (channel: string) => Promise<string | null>;
  debug?: boolean;
}

export function createWebCentrifugeRealtime(config: WebCentrifugeConfig): RealtimeClient {
  return createCentrifugeRealtime({
    url: config.url,
    getToken: config.getToken,
    getSubscriptionToken: config.getSubscriptionToken,
    ...(config.debug !== undefined && { debug: config.debug }),
  });
}
