/**
 * `@repo/realtime` — vendor-agnostic realtime/WebSocket seam (ADR 0029).
 *
 * Neutral barrel: the contract, the no-op default, and the in-memory mock —
 * no vendor SDK import. The Centrifugo adapter lives behind
 * `@repo/realtime/centrifuge` (optional `centrifuge` peer); React hooks
 * behind `@repo/realtime/react`.
 */
export type {
  ConnectionState,
  RealtimeClient,
  RealtimePublication,
  RealtimeSubscription,
  StreamPosition,
  SubscribedContext,
  SubscribeOptions,
  SubscriptionHandlers,
} from "./types";
export { createNoopRealtime } from "./noop";
export { createMockRealtime } from "./mock";
export type { MockRealtime, MockRealtimeOptions } from "./mock";
