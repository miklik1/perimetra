import { createFanoutRegistry, type FanoutSink } from "./fanout";
import type { ConnectionState, RealtimeClient, StreamPosition, SubscribedContext } from "./types";

/** Test driver surface on top of the contract. */
export interface MockRealtime extends RealtimeClient {
  /** Deliver a publication to every consumer of the channel (no-op if not open). */
  emit<T>(channel: string, data: T, position?: StreamPosition): void;
  /** Fire every consumer's `onError` handler on the channel. */
  emitError(channel: string, error: Error): void;
  /** Force a connection state and notify listeners (e.g. simulate a drop). */
  setState(state: ConnectionState): void;
  /**
   * Channels with **at least one live consumer**, in first-subscribe order.
   * Note the difference from `openChannels()`: after the last consumer leaves, a
   * channel disappears from here immediately but stays open until the fan-out
   * registry's microtask teardown runs.
   */
  activeChannels(): string[];
  /** Channels whose (single) mock subscription is open — a superset of `activeChannels()`. */
  openChannels(): string[];
  /** Live consumers fanned out on a channel. */
  consumerCount(channel: string): number;
  /**
   * How many times this channel's subscription was opened, cumulative over the
   * client's life. The only way to observe the teardown grace window: a
   * StrictMode remount leaves this at 1, an eager teardown would make it 2.
   */
  openCount(channel: string): number;
  /** The `since` position the channel's subscription was opened with, if any. */
  subscribedSince(channel: string): StreamPosition | undefined;
}

export interface MockRealtimeOptions {
  /** Initial state. Defaults to `"connected"` so tests skip connect ceremony. */
  initialState?: ConnectionState;
  /**
   * `SubscribedContext` served to `onSubscribed` (per channel, else for all).
   * Lets tests script recovery outcomes (`wasRecovering`/`recovered`). `origin`
   * is deliberately not scriptable — it is a fact about the registry (did this
   * consumer open the channel or join it), never about the adapter.
   */
  subscribedContext?: (channel: string) => Partial<Omit<SubscribedContext, "origin" | "channel">>;
}

/** One open mock subscription — the fan-out registry's `Handle` for this adapter. */
interface OpenChannel {
  sink: FanoutSink;
  since: StreamPosition | undefined;
  /**
   * Where this subscription's stream has actually REACHED: `since` at open, then
   * every position the mock emits. This — not `since` — is what each (re)connect
   * reports, mirroring the Centrifugo adapter, whose `ctx.streamPosition` is the
   * server's CURRENT position and not the one the subscription was created with.
   *
   * Reporting `since` on every reconnect instead was a real divergence: the
   * registry trusts the reported position and replays it to late joiners, so the
   * mock rewound its own channel (measured: 9 back to 4) and the rewind escaped
   * to any second consumer. A mock that diverges from the adapter lies to every
   * test written against it, which is the whole reason the conformance table
   * exists — and it now pins this.
   */
  position: StreamPosition | undefined;
  /** `onSubscribed` fires once per (re)connect, mirroring real adapters. */
  notified: boolean;
}

/**
 * In-memory adapter for tests (ADR 0029): deterministic, synchronous, no
 * sockets, no timers. Honors the contract's queueing rule — subscriptions
 * registered while disconnected activate (fire `onSubscribed`) when the state
 * is driven to `"connected"` — and routes every subscription through the SAME
 * fan-out registry the real adapters use, so a test that passes here cannot be
 * passing on mock-only semantics.
 */
export function createMockRealtime(options: MockRealtimeOptions = {}): MockRealtime {
  let state: ConnectionState = options.initialState ?? "connected";
  const listeners = new Set<(state: ConnectionState) => void>();
  const open = new Map<string, OpenChannel>();
  /**
   * Cumulative `open()` calls per channel, over this mock's life. It lives HERE,
   * in the only adapter that reads it, and NOT in the shared fan-out registry.
   *
   * To answer the question it exists for — "did this channel open once across a
   * StrictMode double-mount?" — the counter must survive both teardown and
   * `reset()`, which makes it a map nothing ever clears. In a test double,
   * bounded by one test, that costs nothing. In the shared registry it made
   * every production client retain one entry per distinct channel name for the
   * whole session — for the per-entity channels these repos model (`user:<id>`,
   * `project:<id>`), one permanent entry per entity ever viewed — while having
   * no production reader at all: `centrifuge.ts` and `noop.ts` never exposed it.
   */
  const openCounts = new Map<string, number>();

  function activate(channel: string, record: OpenChannel): void {
    if (state !== "connected" || record.notified) return;
    record.notified = true;
    record.sink.subscribed({
      wasRecovering: record.since !== undefined,
      recovered: record.since !== undefined,
      position: record.position,
      ...options.subscribedContext?.(channel),
    });
  }

  const registry = createFanoutRegistry<OpenChannel>({
    open(channel, since, sink) {
      const record: OpenChannel = { sink, since, position: since, notified: false };
      open.set(channel, record);
      openCounts.set(channel, (openCounts.get(channel) ?? 0) + 1);
      // Synchronous `subscribed` straight out of open when already connected —
      // precisely the case the registry's insert-before-open ordering rule
      // exists for, and the mock is what pins it.
      activate(channel, record);
      return record;
    },
    close(channel, record) {
      if (open.get(channel) === record) open.delete(channel);
    },
  });

  return {
    connect: () => {},
    disconnect() {
      registry.reset();
      this.setState("disconnected");
    },
    getState: () => state,
    onStateChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    subscribe: registry.subscribe,
    setToken: () => {},

    emit<T>(channel: string, data: T, position?: StreamPosition) {
      const record = open.get(channel);
      if (!record) return;
      // The stream advances — so a later reconnect reports where it got to.
      if (position) record.position = position;
      record.sink.publication({ data, position });
    },
    emitError(channel, error) {
      open.get(channel)?.sink.error(error);
    },
    setState(next) {
      if (next === state) return;
      state = next;
      if (next !== "connected") {
        // A drop re-arms `onSubscribed` for the next reconnect.
        for (const record of open.values()) record.notified = false;
      }
      listeners.forEach((listener) => listener(next));
      if (next === "connected") {
        for (const [channel, record] of Array.from(open)) activate(channel, record);
      }
    },
    activeChannels: registry.activeChannels,
    openChannels: registry.openChannels,
    consumerCount: registry.consumerCount,
    openCount: (channel) => openCounts.get(channel) ?? 0,
    subscribedSince: registry.openedSince,
  };
}
