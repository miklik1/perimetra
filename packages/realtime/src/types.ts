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

/**
 * How a consumer arrived at a subscribed channel.
 *
 * - `"opened"` — the vendor subscription itself (re)subscribed. The context is
 *   the adapter's own report and every consumer on the channel receives it.
 * - `"joined"` — synthesised for a consumer that attached to a channel another
 *   consumer had ALREADY opened. No vendor round-trip happened, so it reports
 *   no recovery (see `SubscribedContext.origin`).
 */
export type SubscribedOrigin = "opened" | "joined";

/** Outcome of a (re)subscribe, surfaced so apps can react to recovery results. */
export interface SubscribedContext {
  channel: string;
  /**
   * Which of the two arrivals this is. **Required on purpose**: a channel with
   * two consumers has exactly one vendor subscription, so the second consumer's
   * `onSubscribed` is a registry-synthesised join, not a real (re)subscribe —
   * an app that treats the two identically will mis-handle recovery. Making the
   * field required means every adapter and every hand-rolled test double that
   * builds a `SubscribedContext` fails `check-types` until it says which it is,
   * rather than silently defaulting to the wrong one.
   *
   * A `"joined"` context always reports `wasRecovering: false, recovered:
   * false` — honest, because the joiner attempted no recovery — which keeps the
   * standard `wasRecovering && !recovered → mark stale` app check correct.
   */
  origin: SubscribedOrigin;
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

/**
 * Handle for ONE consumer's registration on a channel. Not a handle on the
 * vendor subscription — several of these may share one (see `RealtimeClient`).
 * `unsubscribe` releases exactly this consumer and must be called exactly once.
 */
export interface RealtimeSubscription {
  readonly channel: string;
  unsubscribe(): void;
}

/** The cases the realtime contract deliberately refuses to guess about. */
export type RealtimeContractErrorCode =
  /**
   * Two live consumers on one channel asked to resume from different stream
   * positions. A channel has exactly one vendor subscription and its position
   * is fixed when it opens, so there is no honest answer — give the second
   * consumer its own channel, or drop its `since` and join the live stream.
   */
  | "since-conflict"
  /**
   * A `RealtimeSubscription` was released twice. Two owners are sharing one
   * handle, which means the channel's refcount is already wrong.
   */
  | "double-release";

/**
 * Thrown for the contract violations above. Carries a machine-readable `code`
 * so callers and tests branch on the case rather than on message text — the
 * message is free to improve, the code is the API.
 *
 * A class (not a type) is the one piece of runtime code in this module: it is
 * part of the contract, and keeping it here means `@repo/realtime` and
 * `@repo/realtime/react` both surface it from the same declaration.
 */
export class RealtimeContractError extends Error {
  readonly code: RealtimeContractErrorCode;
  readonly channel: string;

  constructor(code: RealtimeContractErrorCode, channel: string, message: string) {
    super(message);
    this.name = "RealtimeContractError";
    this.code = code;
    this.channel = channel;
  }
}

/**
 * The client contract. **One VENDOR subscription per channel, any number of
 * consumers on it**: `subscribe` on a channel that is already open registers an
 * additional consumer and every consumer receives every publication, error and
 * (re)subscribe. `subscribe` may be called in any connection state — adapters
 * queue and activate on (re)connect, so callers never order calls around the
 * socket.
 *
 * Two rules the fan-out cannot model, both of which throw a
 * `RealtimeContractError` rather than degrading: two live consumers with
 * different `since` positions (`"since-conflict"`), and releasing one
 * consumer's handle twice (`"double-release"`).
 *
 * The SAME `RealtimePublication` object is handed to every consumer — it is not
 * cloned per consumer, because cloning every message on a hot socket is a real
 * cost. **Consumers must not mutate it** (nor its `data`); copy first if you
 * need to. This is documented, not enforced.
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
