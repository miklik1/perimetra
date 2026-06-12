/**
 * The vendor-agnostic realtime contract (ADR 0029). App code depends on this
 * interface (or the React hooks over it), never on a Centrifugo/Pusher/Ably
 * SDK — swappable, fakeable in tests. Domain semantics (what a channel means,
 * when to stop listening, how an event mutates a store) stay in the app: this
 * package owns transport only, mirroring `@repo/api`'s seam (ADR 0007/0012).
 */

/** Connection lifecycle, lowest common denominator across vendors. */
export type ConnectionState = "disconnected" | "connecting" | "connected";

/**
 * A position in a channel's message stream, for history recovery after a
 * dropped connection (Centrifugo's `offset`/`epoch` model). Adapters that
 * can't replay history simply never report one.
 */
export interface StreamPosition {
  offset: number;
  epoch: string;
}

/** One message delivered on a channel. */
export interface RealtimePublication<T = unknown> {
  data: T;
  /** Present when the adapter tracks stream positions (recovery-capable). */
  position?: StreamPosition;
}

/** Outcome of a (re)subscribe, surfaced so apps can react to recovery results. */
export interface SubscribedContext {
  channel: string;
  /** True when the adapter attempted history recovery for this subscribe. */
  wasRecovering: boolean;
  /**
   * True when recovery succeeded (missed messages were replayed). When
   * `wasRecovering` is true and this is false, the stream was lost — the app
   * must treat in-flight state as stale (refetch, mark expired, etc.).
   */
  recovered: boolean;
  position?: StreamPosition;
}

export interface SubscriptionHandlers<T = unknown> {
  onPublication: (publication: RealtimePublication<T>) => void;
  onSubscribed?: (context: SubscribedContext) => void;
  onError?: (error: Error) => void;
}

export interface SubscribeOptions {
  /** Resume from a stored position (history recovery), when the adapter supports it. */
  since?: StreamPosition;
}

/** Handle for one active channel subscription. */
export interface RealtimeSubscription {
  readonly channel: string;
  unsubscribe(): void;
}

/**
 * The client contract. One logical subscription per channel: `subscribe` on a
 * channel that is already active throws (a programming error — apps own the
 * channel lifecycle; fan-out to multiple consumers belongs above this seam).
 * `subscribe` may be called in any connection state — adapters queue and
 * activate on (re)connect, so callers never order calls around the socket.
 */
export interface RealtimeClient {
  connect(): void;
  /** Tears down all subscriptions and closes the connection. */
  disconnect(): void;
  getState(): ConnectionState;
  /** Returns an unsubscribe function. */
  onStateChange(listener: (state: ConnectionState) => void): () => void;
  subscribe<T = unknown>(
    channel: string,
    handlers: SubscriptionHandlers<T>,
    options?: SubscribeOptions,
  ): RealtimeSubscription;
  /**
   * Pushes a new connection token (auth rotation). The token is injected, not
   * imported — the app wires `@repo/auth` into realtime at its composition
   * root, so no `realtime → auth` edge exists (the ADR 0028 distinctId rule).
   */
  setToken(token: string | null): void;
}
