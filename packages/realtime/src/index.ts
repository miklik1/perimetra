/**
 * `@repo/realtime` — vendor-agnostic realtime/WebSocket seam (ADR 0029).
 *
 * Neutral barrel: the contract, the no-op default, and the in-memory mock —
 * no vendor SDK import. The Centrifugo adapter lives behind
 * `@repo/realtime/centrifuge` (optional `centrifuge` peer); React hooks
 * behind `@repo/realtime/react`.
 *
 * The channel fan-out registry every adapter composes stays INTERNAL
 * (`src/fanout.ts`, not on the `exports` map): it is one implementation shared
 * by the adapters, and publishing it would invite a second, divergent copy of
 * the refcount rules in app code.
 */
export type {
  ConnectionState,
  RealtimeClient,
  RealtimeContractErrorCode,
  RealtimePublication,
  RealtimeSubscription,
  StreamPosition,
  SubscribedContext,
  SubscribedOrigin,
  SubscribeOptions,
  SubscriptionHandlers,
} from "./types";
export { RealtimeContractError } from "./types";
export { createNoopRealtime } from "./noop";
export { createMockRealtime } from "./mock";
export type { MockRealtime, MockRealtimeOptions } from "./mock";
