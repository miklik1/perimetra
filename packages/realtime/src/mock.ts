import type {
  ConnectionState,
  RealtimeClient,
  RealtimePublication,
  RealtimeSubscription,
  StreamPosition,
  SubscribedContext,
  SubscriptionHandlers,
} from "./types";

/** Test driver surface on top of the contract. */
export interface MockRealtime extends RealtimeClient {
  /** Deliver a publication to the channel's handlers (no-op if not subscribed). */
  emit<T>(channel: string, data: T, position?: StreamPosition): void;
  /** Fire the channel's `onError` handler. */
  emitError(channel: string, error: Error): void;
  /** Force a connection state and notify listeners (e.g. simulate a drop). */
  setState(state: ConnectionState): void;
  /** Channels with an active subscription, in subscribe order. */
  activeChannels(): string[];
  /** The `since` position the channel subscribed with, if any. */
  subscribedSince(channel: string): StreamPosition | undefined;
}

export interface MockRealtimeOptions {
  /** Initial state. Defaults to `"connected"` so tests skip connect ceremony. */
  initialState?: ConnectionState;
  /**
   * `SubscribedContext` served to `onSubscribed` (per channel, else for all).
   * Lets tests script recovery outcomes (`wasRecovering`/`recovered`).
   */
  subscribedContext?: (channel: string) => Partial<SubscribedContext>;
}

interface Entry {
  handlers: SubscriptionHandlers<unknown>;
  since?: StreamPosition;
  /** `onSubscribed` fires once per (re)connect, mirroring real adapters. */
  notified: boolean;
}

/**
 * In-memory adapter for tests (ADR 0029): deterministic, synchronous, no
 * sockets, no timers. Honors the contract's queueing rule — subscriptions
 * registered while disconnected activate (fire `onSubscribed`) when the state
 * is driven to `"connected"`.
 */
export function createMockRealtime(options: MockRealtimeOptions = {}): MockRealtime {
  let state: ConnectionState = options.initialState ?? "connected";
  const listeners = new Set<(state: ConnectionState) => void>();
  const entries = new Map<string, Entry>();

  function contextFor(channel: string, entry: Entry): SubscribedContext {
    return {
      channel,
      wasRecovering: entry.since !== undefined,
      recovered: entry.since !== undefined,
      position: entry.since,
      ...options.subscribedContext?.(channel),
    };
  }

  function activate(channel: string, entry: Entry): void {
    if (state !== "connected" || entry.notified) return;
    entry.notified = true;
    entry.handlers.onSubscribed?.(contextFor(channel, entry));
  }

  return {
    connect: () => {},
    disconnect() {
      entries.clear();
      this.setState("disconnected");
    },
    getState: () => state,
    onStateChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    subscribe<T>(
      channel: string,
      handlers: SubscriptionHandlers<T>,
      subscribeOptions?: { since?: StreamPosition },
    ): RealtimeSubscription {
      if (entries.has(channel)) {
        throw new Error(`Already subscribed to channel "${channel}"`);
      }
      const entry: Entry = {
        handlers: handlers as SubscriptionHandlers<unknown>,
        since: subscribeOptions?.since,
        notified: false,
      };
      entries.set(channel, entry);
      activate(channel, entry);
      return {
        channel,
        unsubscribe: () => entries.delete(channel),
      };
    },
    setToken: () => {},

    emit<T>(channel: string, data: T, position?: StreamPosition) {
      const entry = entries.get(channel);
      if (!entry) return;
      const publication: RealtimePublication<unknown> = { data, position };
      entry.handlers.onPublication(publication);
    },
    emitError(channel, error) {
      entries.get(channel)?.handlers.onError?.(error);
    },
    setState(next) {
      if (next === state) return;
      state = next;
      if (next !== "connected") {
        // A drop re-arms `onSubscribed` for the next reconnect.
        for (const entry of entries.values()) entry.notified = false;
      }
      listeners.forEach((listener) => listener(next));
      if (next === "connected") {
        for (const [channel, entry] of entries) activate(channel, entry);
      }
    },
    activeChannels: () => Array.from(entries.keys()),
    subscribedSince: (channel) => entries.get(channel)?.since,
  };
}
