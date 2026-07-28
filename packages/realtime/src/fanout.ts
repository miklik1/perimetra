import {
  RealtimeContractError,
  type RealtimePublication,
  type RealtimeSubscription,
  type StreamPosition,
  type SubscribedContext,
  type SubscribeOptions,
  type SubscriptionHandlers,
} from "./types";

/**
 * The channel fan-out registry — the one place `@repo/realtime` turns "N
 * consumers want this channel" into "ONE vendor subscription" (ADR 0029, as
 * amended: see the fan-out ADR in `docs/adr/`).
 *
 * ## Why this module exists
 *
 * Adapters used to key one subscription per channel and THROW on a duplicate.
 * That is the right guard for a TRANSPORT subscription (you genuinely cannot
 * open the same Centrifugo subscription twice) and the wrong one for a CONSUMER
 * registration: a broadcast channel like `org:<id>` legitimately has several
 * independent readers. Worse, the React hook caught that throw — correctly, for
 * the StrictMode mount→cleanup→mount race it was written for — so the second
 * legitimate consumer silently got no subscription at all. No error, no
 * boundary, no failing test; the symptom was a stray console warning.
 *
 * Separating the two concerns fixes the class: the adapter still opens exactly
 * one vendor subscription per channel, and this registry refcounts the
 * consumers on it. `consumers.size` IS the refcount.
 *
 * ## Why it is internal
 *
 * Not on the package `exports` map, so the ADR 0011 deep-import ban keeps it
 * private and no app can grow a second, divergent copy of these rules. Every
 * adapter in this package (`centrifuge.ts`, `mock.ts`, `noop.ts`) composes it —
 * including the no-op, which would otherwise be a lie by exemption: a no-op that
 * silently tolerates a double release teaches app code a habit the real adapter
 * punishes.
 */

/** What an adapter reports when the VENDOR subscription really (re)subscribed. */
type VendorSubscribedContext = Omit<SubscribedContext, "channel" | "origin">;

/**
 * Where an adapter pushes vendor events. The registry owns `channel` and
 * `origin` on the way out — an adapter has no way to know whether a given
 * consumer opened the channel or joined it, so it is not asked.
 */
export interface FanoutSink {
  publication(publication: RealtimePublication<unknown>): void;
  subscribed(context: VendorSubscribedContext): void;
  error(error: Error): void;
}

/**
 * The vendor seam. `open` is called for the FIRST consumer on a channel and
 * `close` after the LAST one leaves; everything between is the registry's.
 * `Handle` is whatever the adapter needs back to close (an SDK `Subscription`,
 * a record in a map, `{}` for the no-op).
 */
export interface FanoutAdapter<Handle> {
  open(channel: string, since: StreamPosition | undefined, sink: FanoutSink): Handle;
  close(channel: string, handle: Handle): void;
}

export interface FanoutRegistry {
  subscribe<T>(
    channel: string,
    handlers: SubscriptionHandlers<T>,
    options?: SubscribeOptions,
  ): RealtimeSubscription;
  /**
   * Drop everything now: close every open channel, cancel every pending
   * teardown, and make outstanding handles inert (their `unsubscribe` becomes a
   * no-op — but still throws on a SECOND call, see below). Adapters call this
   * from `disconnect()`.
   */
  reset(): void;
  /** Channels with at least one live consumer, in first-subscribe order. */
  activeChannels(): string[];
  /** Channels whose vendor subscription is open — a superset of the above. */
  openChannels(): string[];
  /** Live consumers on a channel; `0` for an unknown or draining channel. */
  consumerCount(channel: string): number;
  /** The `since` the channel's vendor subscription was opened with. */
  openedSince(channel: string): StreamPosition | undefined;
}

/**
 * NO cumulative per-channel counter lives here — deliberately. "How many times
 * did this channel open over the client's life" has to survive both teardown and
 * `reset()` to mean anything (that IS the question: did a StrictMode
 * double-mount open once or twice), which makes it a map that is never cleared:
 * one retained entry per distinct channel name, forever. For the per-entity
 * channels these repos model (`user:<id>`, `project:<id>`) a long-lived session
 * accumulates one permanent entry per entity ever viewed. It used to live here
 * and had no production reader at all — only the mock exposed it. It now lives
 * in `mock.ts`, the one adapter that reads it, where the retention is bounded by
 * the test. Every accessor above is derived from `channels`, which reaping
 * empties.
 */

interface Entry<Handle> {
  /**
   * `undefined` only inside the window between creating the entry and
   * `adapter.open()` returning — see the ordering rule in `subscribe`. No
   * adapter in this package ever produces an `undefined` handle.
   */
  handle: Handle | undefined;
  /**
   * Keyed by an INTEGER consumer id, NOT a `Set` of handler objects. Two
   * consumers may legitimately pass the same handlers object (a shared module
   * constant, a memoised callback bag); a `Set` would dedupe them and drop one
   * silently — the exact bug class this registry exists to kill, one level down.
   */
  consumers: Map<number, SubscriptionHandlers<unknown>>;
  /** The position the vendor subscription was opened with. Fixed for its lifetime. */
  openedSince: StreamPosition | undefined;
  /** Latest position seen on this channel, replayed to late joiners. */
  position: StreamPosition | undefined;
  /**
   * The last REAL (vendor) subscribed context. Its presence is the signal that
   * the channel is actually live, so a late joiner gets a synthetic
   * `"joined"` context immediately instead of waiting for a resubscribe.
   */
  lastContext: SubscribedContext | undefined;
  /** Cancels the scheduled teardown, when one is pending. */
  cancelTeardown: (() => void) | undefined;
}

function samePosition(a: StreamPosition | undefined, b: StreamPosition | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.offset === b.offset && a.epoch === b.epoch;
}

function describePosition(position: StreamPosition | undefined): string {
  return position ? `offset ${position.offset} (epoch "${position.epoch}")` : "the live stream";
}

/**
 * Does `next` move the channel's tracked position FORWARD?
 *
 * Within one epoch a lower offset is a REWIND, and the registry refuses it. The
 * tracked position is replayed to every late joiner, so accepting a rewind
 * hands a new consumer a position the channel has already passed — and, because
 * `subscribed` fires on every reconnect, an adapter that reports the position it
 * OPENED with (rather than the one the stream has reached) would drag the
 * registry backwards on every single reconnect. The mock did exactly that; this
 * rule is the registry half of the fix, and `mock.ts` reporting its real
 * position is the honest half.
 *
 * A DIFFERENT epoch always wins: Centrifugo mints a new epoch when a channel's
 * history is recreated and offsets restart from zero, so the two numbers are not
 * comparable and a lower offset there is a new stream, not a rewind of this one.
 *
 * Note the scope — this guards only what the REGISTRY tracks and replays. The
 * `SubscribedContext` handed to consumers still carries the adapter's own
 * report verbatim: that is the adapter's statement about its own (re)subscribe,
 * and rewriting it would hide an adapter defect instead of surfacing it.
 */
function advancesFrom(current: StreamPosition | undefined, next: StreamPosition): boolean {
  if (!current) return true;
  if (current.epoch !== next.epoch) return true;
  return next.offset >= current.offset;
}

export function createFanoutRegistry<Handle>(adapter: FanoutAdapter<Handle>): FanoutRegistry {
  const channels = new Map<string, Entry<Handle>>();
  let nextConsumerId = 0;

  /** Delivery iterates a SNAPSHOT — a handler may (un)subscribe during delivery. */
  function snapshot(entry: Entry<Handle>): SubscriptionHandlers<unknown>[] {
    return Array.from(entry.consumers.values());
  }

  function sinkFor(channel: string, entry: Entry<Handle>): FanoutSink {
    return {
      publication(publication) {
        if (publication.position && advancesFrom(entry.position, publication.position)) {
          entry.position = publication.position;
        }
        // The same object goes to every consumer — no clone. Mutating it is
        // forbidden by the contract (see `RealtimeClient`), not prevented:
        // freezing every publication on a hot socket is a real cost.
        for (const consumer of snapshot(entry)) consumer.onPublication(publication);
      },
      subscribed(context) {
        const full: SubscribedContext = { channel, origin: "opened", ...context };
        entry.lastContext = full;
        if (context.position && advancesFrom(entry.position, context.position)) {
          entry.position = context.position;
        }
        for (const consumer of snapshot(entry)) consumer.onSubscribed?.(full);
      },
      error(error) {
        for (const consumer of snapshot(entry)) consumer.onError?.(error);
      },
    };
  }

  /** Close the vendor subscription NOW and forget the entry. */
  function reap(channel: string, entry: Entry<Handle>): void {
    entry.cancelTeardown?.();
    if (channels.get(channel) === entry) channels.delete(channel);
    if (entry.handle !== undefined) adapter.close(channel, entry.handle);
  }

  /**
   * Teardown is DEFERRED by one microtask, and that is measured behaviour, not
   * taste. React 19 runs every effect cleanup and then every effect setup inside
   * ONE synchronous flush, so a channel whose only consumer is remounted
   * (StrictMode) or swapped for an identical one (a re-keyed component) drops to
   * zero consumers and comes back in the same tick. Closing inline would churn
   * the vendor subscription every time: the adapter loses its tracked `epoch`,
   * and the web app's per-channel adapter fires a fresh
   * `POST /v1/realtime/subscribe-token` on each remount.
   *
   * A MICROTASK specifically — `Promise.resolve().then()`, not `queueMicrotask`
   * (universally available including Hermes/React Native), and not `setTimeout`
   * (which would make every mock test wait on a timer instead of a single
   * `await`).
   */
  function scheduleTeardown(channel: string, entry: Entry<Handle>): void {
    let cancelled = false;
    entry.cancelTeardown = () => {
      cancelled = true;
      entry.cancelTeardown = undefined;
    };
    void Promise.resolve().then(() => {
      if (cancelled) return;
      entry.cancelTeardown = undefined;
      // Re-check rather than trust the schedule: a consumer may have arrived
      // (and possibly left again, re-scheduling) since this was queued.
      if (entry.consumers.size > 0) return;
      if (channels.get(channel) !== entry) return;
      reap(channel, entry);
    });
  }

  function makeSubscription(
    channel: string,
    entry: Entry<Handle>,
    id: number,
  ): RealtimeSubscription {
    let released = false;
    return {
      channel,
      unsubscribe() {
        if (released) {
          throw new RealtimeContractError(
            "double-release",
            channel,
            `Subscription to channel "${channel}" was already released. Each subscribe() ` +
              `returns one consumer's handle and it must be released exactly once; a second ` +
              `release means two owners share one handle and the channel's refcount is wrong.`,
          );
        }
        released = true;
        entry.consumers.delete(id);
        // Deliberately SILENT when the entry is no longer the registered one.
        // That covers `unsubscribe()` after `disconnect()`, which is not a
        // programming error but the normal React teardown order: the provider's
        // cleanup (disconnect) runs before its children's cleanups (unsubscribe),
        // so making this loud would throw on every app teardown. Double release
        // stays loud because it is tracked by the per-handle flag above, not by
        // "is the entry still there".
        if (channels.get(channel) !== entry) return;
        if (entry.consumers.size > 0) return;
        scheduleTeardown(channel, entry);
      },
    };
  }

  function subscribe<T>(
    channel: string,
    handlers: SubscriptionHandlers<T>,
    options?: SubscribeOptions,
  ): RealtimeSubscription {
    const since = options?.since;
    const id = nextConsumerId++;
    let entry = channels.get(channel);

    // A `since` that DIFFERS from the one a draining entry (zero consumers,
    // teardown pending) was opened with: nobody is left to disagree with it, so
    // reap now and re-open at the requested position rather than throwing below.
    //
    // The `!samePosition` clause is load-bearing. A `since` that deep-equals
    // `openedSince` falls through and JOINS the pending entry, cancelling its
    // teardown exactly like the no-since path — which is the StrictMode /
    // re-keyed-remount case the grace window exists for. Reaping on ANY `since`
    // defeated that window for every since-bearing consumer: measured through
    // `useChannel` under `<StrictMode>` as openCount 2 with `since` against 1
    // without, and on the Centrifugo adapter as two `newSubscription` calls and
    // two subscription-token mints for one channel.
    //
    // (The since-conflict throw below is NOT what this rule avoids — it only
    // fires on a position that differs. An earlier comment here claimed a
    // deep-equal remount would false-throw against its own draining
    // subscription; it never could.)
    if (entry && since && entry.consumers.size === 0 && !samePosition(since, entry.openedSince)) {
      reap(channel, entry);
      entry = undefined;
    }

    if (entry) {
      // A vendor subscription's position is fixed when it opens, so two LIVE
      // consumers cannot disagree about it. There is no honest merge at this
      // seam — per-consumer history replay is not modelled — so it throws.
      //
      // The message must name the MOUNT-ORDER asymmetry, because the throw is
      // order-dependent and nothing else tells the reader so: a consumer with no
      // `since` joins whatever position the channel already has, so
      // `[since, no-since]` is silent while `[no-since, since]` throws. Two
      // components sharing a broadcast channel is the case this package
      // advertises as normal, and one of them adding a `since` turns the pair
      // into a crash that depends on which mounted first. A reader who is only
      // told "one stream position" has no way to guess that reordering fixes it.
      if (since && !samePosition(since, entry.openedSince)) {
        throw new RealtimeContractError(
          "since-conflict",
          channel,
          `Channel "${channel}" is already open from ${describePosition(entry.openedSince)} with ` +
            `${entry.consumers.size} live consumer(s); this one asked to resume from ` +
            `${describePosition(since)}. One vendor subscription per channel means one stream ` +
            `position, so this throw is MOUNT-ORDER dependent: had the consumer asking for ` +
            `${describePosition(since)} subscribed FIRST, the other one would have joined it ` +
            `without error. Fix it by subscribing the since-bearing consumer first, or by giving ` +
            `it its own channel. Dropping its \`since\` also works and forfeits the history: it ` +
            `then joins the live stream.`,
        );
      }
      entry.cancelTeardown?.();
      entry.consumers.set(id, handlers as SubscriptionHandlers<unknown>);
      // Replay only once the vendor really subscribed. Before that, the joiner
      // simply waits and receives the real `"opened"` context with everyone else.
      if (entry.lastContext) {
        handlers.onSubscribed?.({
          channel,
          origin: "joined",
          // Honest: this consumer attempted no recovery. It also keeps the
          // standard `wasRecovering && !recovered → mark stale` check correct.
          wasRecovering: false,
          recovered: false,
          position: entry.position,
        });
      }
      return makeSubscription(channel, entry, id);
    }

    const created: Entry<Handle> = {
      handle: undefined,
      consumers: new Map(),
      openedSince: since,
      position: since,
      lastContext: undefined,
      cancelTeardown: undefined,
    };
    // ORDERING RULE — the first consumer is inserted BEFORE `adapter.open()`.
    // Adapters may deliver `subscribed` SYNCHRONOUSLY from open (the mock does,
    // whenever it is already "connected"), and a consumer registered afterwards
    // would miss its own onSubscribed. Found by prototype failure; pinned by a
    // test.
    created.consumers.set(id, handlers as SubscriptionHandlers<unknown>);
    channels.set(channel, created);

    const handle = adapter.open(channel, since, sinkFor(channel, created));
    if (channels.get(channel) === created) {
      created.handle = handle;
    } else {
      // A handler that ran synchronously inside open tore the registry down
      // (disconnect, or a since-bearing re-subscribe). The entry is gone, so the
      // handle we were just given would leak — close it here.
      adapter.close(channel, handle);
    }
    return makeSubscription(channel, created, id);
  }

  return {
    subscribe,
    reset() {
      for (const [channel, entry] of Array.from(channels)) {
        channels.delete(channel);
        // Clear consumers BEFORE closing, so a vendor event fired from inside
        // `close` fans out to nobody rather than to already-torn-down consumers.
        entry.consumers.clear();
        reap(channel, entry);
      }
    },
    activeChannels: () =>
      Array.from(channels)
        .filter(([, entry]) => entry.consumers.size > 0)
        .map(([channel]) => channel),
    openChannels: () => Array.from(channels.keys()),
    consumerCount: (channel) => channels.get(channel)?.consumers.size ?? 0,
    openedSince: (channel) => channels.get(channel)?.openedSince,
  };
}
