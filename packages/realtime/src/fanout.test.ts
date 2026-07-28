import { describe, expect, it, vi } from "vitest";

import { createFanoutRegistry, type FanoutSink } from "./fanout";
import { describeFanoutConformance, flushTeardown } from "./fanout-conformance";
import { createMockRealtime } from "./mock";
import { createNoopRealtime } from "./noop";
import { RealtimeContractError, type SubscribedContext } from "./types";

// The shared behaviour table, run against the two adapters this file owns. The
// Centrifugo arm runs in centrifuge.test.ts, over its SDK fake.
describeFanoutConformance({
  name: "mock adapter",
  observable: true,
  create() {
    const client = createMockRealtime();
    return {
      client,
      openCount: (channel) => client.openCount(channel),
      isOpen: (channel) => client.openChannels().includes(channel),
      emit: (channel, data, position) => client.emit(channel, data, position),
      emitError: (channel, error) => client.emitError(channel, error),
      // The mock fires `subscribed` synchronously from open when connected, so
      // the first one has already happened by the time a test asks.
      settle: () => {},
      resubscribe: () => {
        client.setState("disconnected");
        client.setState("connected");
      },
    };
  },
});

describeFanoutConformance({
  name: "noop adapter",
  // Permanently disconnected, delivers nothing, exposes no vendor side — the
  // vendor-observable half of the table is skipped rather than faked. What it
  // MUST still honour is every registry rule, which is why it composes the same
  // registry instead of being exempted.
  observable: false,
  create() {
    const client = createNoopRealtime();
    return {
      client,
      openCount: () => 0,
      isOpen: () => false,
      emit: () => {},
      emitError: () => {},
      settle: () => {},
      resubscribe: () => {},
    };
  },
});

/**
 * A minimal adapter that records what the registry asks of it, so the registry's
 * own invariants can be asserted without any vendor semantics in the way.
 * `subscribeOnOpen` reproduces the trap the ordering rule exists for: an adapter
 * that delivers `subscribed` synchronously from `open`.
 */
function recordingAdapter(subscribeOnOpen: boolean) {
  const opens: { channel: string; since: unknown }[] = [];
  const closes: string[] = [];
  const sinks = new Map<string, FanoutSink>();
  return {
    opens,
    closes,
    sinks,
    adapter: {
      open(channel: string, since: unknown, sink: FanoutSink) {
        opens.push({ channel, since });
        sinks.set(channel, sink);
        if (subscribeOnOpen) sink.subscribed({ wasRecovering: false, recovered: false });
        return { channel };
      },
      close(channel: string) {
        closes.push(channel);
        sinks.delete(channel);
      },
    },
  };
}

describe("createFanoutRegistry", () => {
  it("inserts the first consumer BEFORE opening, so a synchronous subscribed reaches it", () => {
    // The ordering rule, pinned directly. Found by prototype failure: with the
    // insert moved after `adapter.open()`, consumer #1 misses its OWN
    // onSubscribed on every adapter that subscribes synchronously.
    const { adapter } = recordingAdapter(true);
    const registry = createFanoutRegistry(adapter);
    const contexts: SubscribedContext[] = [];

    registry.subscribe("org:1", {
      onPublication: vi.fn(),
      onSubscribed: (context) => contexts.push(context),
    });

    expect(contexts).toEqual([
      { channel: "org:1", origin: "opened", wasRecovering: false, recovered: false },
    ]);
  });

  it("counts consumers, not subscribe calls, and reports both views of a channel", async () => {
    const { adapter, opens } = recordingAdapter(false);
    const registry = createFanoutRegistry(adapter);

    const a = registry.subscribe("org:1", { onPublication: vi.fn() });
    const b = registry.subscribe("org:1", { onPublication: vi.fn() });
    expect(registry.consumerCount("org:1")).toBe(2);
    expect(registry.activeChannels()).toEqual(["org:1"]);
    expect(registry.openChannels()).toEqual(["org:1"]);
    // Opens are counted by the ADAPTER now, not by the registry — see the
    // retention test at the bottom of this block.
    expect(opens).toHaveLength(1);

    a.unsubscribe();
    expect(registry.consumerCount("org:1")).toBe(1);

    b.unsubscribe();
    // Zero consumers immediately; still open until the grace window closes.
    expect(registry.consumerCount("org:1")).toBe(0);
    expect(registry.activeChannels()).toEqual([]);
    expect(registry.openChannels()).toEqual(["org:1"]);

    await flushTeardown();
    expect(registry.openChannels()).toEqual([]);
  });

  it("cancels a pending teardown rather than closing and re-opening", async () => {
    const { adapter, opens, closes } = recordingAdapter(false);
    const registry = createFanoutRegistry(adapter);

    registry.subscribe("org:1", { onPublication: vi.fn() }).unsubscribe();
    registry.subscribe("org:1", { onPublication: vi.fn() });
    await flushTeardown();

    expect(opens).toHaveLength(1);
    expect(closes).toEqual([]);
  });

  it("re-checks the consumer count inside the grace window before closing", async () => {
    const { adapter, closes } = recordingAdapter(false);
    const registry = createFanoutRegistry(adapter);

    const first = registry.subscribe("org:1", { onPublication: vi.fn() });
    first.unsubscribe();
    const second = registry.subscribe("org:1", { onPublication: vi.fn() });
    second.unsubscribe();
    await flushTeardown();

    // Two teardowns were scheduled across the two releases; exactly one close.
    expect(closes).toEqual(["org:1"]);
  });

  it("keeps the opened `since` for the channel's whole life, not per consumer", () => {
    const { adapter, opens } = recordingAdapter(false);
    const registry = createFanoutRegistry(adapter);

    registry.subscribe("org:1", { onPublication: vi.fn() }, { since: { offset: 3, epoch: "e1" } });
    registry.subscribe("org:1", { onPublication: vi.fn() });

    expect(opens).toEqual([{ channel: "org:1", since: { offset: 3, epoch: "e1" } }]);
    expect(registry.openedSince("org:1")).toEqual({ offset: 3, epoch: "e1" });
  });

  it("hands the SAME publication object to every consumer (no per-consumer clone)", () => {
    const { adapter, sinks } = recordingAdapter(false);
    const registry = createFanoutRegistry(adapter);
    const seen: unknown[] = [];
    registry.subscribe("org:1", { onPublication: (p) => seen.push(p) });
    registry.subscribe("org:1", { onPublication: (p) => seen.push(p) });

    sinks.get("org:1")?.publication({ data: { n: 1 } });

    expect(seen).toHaveLength(2);
    // Documented contract: consumers must not mutate what they are handed.
    expect(seen[0]).toBe(seen[1]);
  });

  it("reset() closes every channel now and leaves outstanding handles inert", async () => {
    const { adapter, closes } = recordingAdapter(false);
    const registry = createFanoutRegistry(adapter);
    const a = registry.subscribe("org:1", { onPublication: vi.fn() });
    registry.subscribe("user:1", { onPublication: vi.fn() });

    registry.reset();

    expect(closes).toEqual(["org:1", "user:1"]);
    expect(registry.openChannels()).toEqual([]);
    expect(() => a.unsubscribe()).not.toThrow();
    await flushTeardown();
    expect(closes).toEqual(["org:1", "user:1"]);
  });

  it("reset() cancels a pending teardown instead of closing twice", async () => {
    const { adapter, closes } = recordingAdapter(false);
    const registry = createFanoutRegistry(adapter);

    registry.subscribe("org:1", { onPublication: vi.fn() }).unsubscribe();
    registry.reset();
    await flushTeardown();

    expect(closes).toEqual(["org:1"]);
  });

  it("refuses a position that moves BACKWARDS within one epoch", () => {
    // The registry half of the mock/adapter position divergence. `subscribed`
    // fires on every reconnect, so an adapter that reports the position it
    // OPENED with drags the tracked position backwards once per reconnect —
    // and the tracked position is what a late joiner is replayed, so the rewind
    // escapes that adapter's own consumers.
    const { adapter, sinks } = recordingAdapter(false);
    const registry = createFanoutRegistry(adapter);
    registry.subscribe("org:1", { onPublication: vi.fn() });
    const sink = sinks.get("org:1")!;

    sink.publication({ data: { n: 1 }, position: { offset: 9, epoch: "e1" } });
    // A reconnect re-reporting the stale open position.
    sink.subscribed({ wasRecovering: true, recovered: true, position: { offset: 4, epoch: "e1" } });
    // ...and a stale publication offset, for the same reason.
    sink.publication({ data: { n: 2 }, position: { offset: 5, epoch: "e1" } });

    const joiner: SubscribedContext[] = [];
    registry.subscribe("org:1", {
      onPublication: vi.fn(),
      onSubscribed: (context) => joiner.push(context),
    });
    expect(joiner[0]?.position).toEqual({ offset: 9, epoch: "e1" });
  });

  it("accepts a lower offset in a NEW epoch — a recreated stream, not a rewind", () => {
    // Centrifugo mints a fresh epoch when a channel's history is recreated and
    // offsets restart from zero, so the two numbers are not comparable and the
    // monotonicity rule must not lock the channel at the old epoch's offset.
    const { adapter, sinks } = recordingAdapter(false);
    const registry = createFanoutRegistry(adapter);
    registry.subscribe("org:1", { onPublication: vi.fn() });
    const sink = sinks.get("org:1")!;

    sink.publication({ data: { n: 1 }, position: { offset: 9, epoch: "e1" } });
    sink.subscribed({
      wasRecovering: true,
      recovered: false,
      position: { offset: 1, epoch: "e2" },
    });

    const joiner: SubscribedContext[] = [];
    registry.subscribe("org:1", {
      onPublication: vi.fn(),
      onSubscribed: (context) => joiner.push(context),
    });
    expect(joiner[0]?.position).toEqual({ offset: 1, epoch: "e2" });
  });

  it("hands the adapter's own reconnect context to consumers unrewritten", () => {
    // The monotonicity rule guards what the REGISTRY tracks and replays. It must
    // not rewrite the context an adapter reports about its own (re)subscribe —
    // that would hide an adapter defect instead of surfacing it to the consumer
    // that can see it.
    const { adapter, sinks } = recordingAdapter(false);
    const registry = createFanoutRegistry(adapter);
    const contexts: SubscribedContext[] = [];
    registry.subscribe("org:1", {
      onPublication: vi.fn(),
      onSubscribed: (context) => contexts.push(context),
    });
    const sink = sinks.get("org:1")!;

    sink.publication({ data: { n: 1 }, position: { offset: 9, epoch: "e1" } });
    sink.subscribed({ wasRecovering: true, recovered: true, position: { offset: 4, epoch: "e1" } });

    expect(contexts.at(-1)?.position).toEqual({ offset: 4, epoch: "e1" });
  });

  it("retains no per-channel state once a channel is torn down", async () => {
    // `openCounts` used to live in the registry: one entry per distinct channel
    // name, never cleared — not by unsubscribe, not by reset(), not by
    // disconnect() — with no production reader (only the mock exposed it). For
    // the per-entity channels these repos model, a long-lived session accumulates
    // one permanent entry per entity ever viewed.
    const { adapter } = recordingAdapter(false);
    const registry = createFanoutRegistry(adapter);

    for (let i = 0; i < 2_000; i += 1) {
      registry.subscribe(`user:${i}`, { onPublication: vi.fn() }).unsubscribe();
      await flushTeardown();
    }

    expect(registry.openChannels()).toEqual([]);
    expect(registry.activeChannels()).toEqual([]);
    // The structural half, and the reason the loop above leaves nothing behind:
    // EVERY accessor the registry exposes is derived from the channel map that
    // reaping empties. A cumulative per-channel counter cannot be — to answer
    // "opened once across a StrictMode double-mount" it must outlive teardown —
    // so it lives in `mock.ts`, the only adapter that reads it. Re-adding one
    // here reds this line and forces the question to be answered again.
    expect(Object.keys(registry).sort()).toEqual([
      "activeChannels",
      "consumerCount",
      "openChannels",
      "openedSince",
      "reset",
      "subscribe",
    ]);
  });

  it("closes a handle whose entry was torn down during open()", () => {
    // Pathological but reachable: a handler firing synchronously inside open
    // disconnects the client. The entry is gone before open returns, so the
    // handle the adapter just produced would leak unless it is closed here.
    const { adapter, closes } = recordingAdapter(false);
    let reset = () => {};
    const registry = createFanoutRegistry({
      open(channel, since, sink) {
        const handle = adapter.open(channel, since, sink);
        reset();
        return handle;
      },
      close: adapter.close,
    });
    reset = () => registry.reset();

    registry.subscribe("org:1", { onPublication: vi.fn() });

    expect(closes).toEqual(["org:1"]);
    expect(registry.openChannels()).toEqual([]);
  });
});

describe("createMockRealtime fan-out driver", () => {
  it("distinguishes active channels from open channels across the grace window", async () => {
    const realtime = createMockRealtime();
    const subscription = realtime.subscribe("org:1", { onPublication: vi.fn() });

    expect(realtime.activeChannels()).toEqual(["org:1"]);
    expect(realtime.openChannels()).toEqual(["org:1"]);
    expect(realtime.consumerCount("org:1")).toBe(1);

    subscription.unsubscribe();
    expect(realtime.activeChannels()).toEqual([]);
    expect(realtime.openChannels()).toEqual(["org:1"]);
    expect(realtime.consumerCount("org:1")).toBe(0);

    await flushTeardown();
    expect(realtime.openChannels()).toEqual([]);
    expect(realtime.openCount("org:1")).toBe(1);
  });

  it("re-fires onSubscribed to every consumer after a drop and reconnect", () => {
    const realtime = createMockRealtime();
    const a = vi.fn();
    const b = vi.fn();
    realtime.subscribe("org:1", { onPublication: vi.fn(), onSubscribed: a });
    realtime.subscribe("org:1", { onPublication: vi.fn(), onSubscribed: b });
    // a: its own `opened`. b: a synthetic `joined`.
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    expect(b.mock.calls[0]?.[0]).toMatchObject({ origin: "joined" });

    realtime.setState("disconnected");
    realtime.setState("connected");

    expect(a).toHaveBeenCalledTimes(2);
    expect(b).toHaveBeenCalledTimes(2);
    expect(a.mock.calls[1]?.[0]).toMatchObject({ origin: "opened" });
    expect(b.mock.calls[1]?.[0]).toMatchObject({ origin: "opened" });
  });

  it("throws a since-conflict carrying the code, not a message shape", () => {
    const realtime = createMockRealtime();
    realtime.subscribe("org:1", { onPublication: vi.fn() }, { since: { offset: 1, epoch: "e1" } });

    expect(() =>
      realtime.subscribe(
        "org:1",
        { onPublication: vi.fn() },
        { since: { offset: 2, epoch: "e1" } },
      ),
    ).toThrow(RealtimeContractError);
  });
});
