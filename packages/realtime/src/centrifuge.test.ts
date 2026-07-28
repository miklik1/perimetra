import { beforeEach, describe, expect, it, vi } from "vitest";

import { createCentrifugeRealtime } from "./centrifuge";
import { describeFanoutConformance, flushTeardown } from "./fanout-conformance";

// Minimal stand-in for the centrifuge SDK: records constructor options,
// exposes `emit` to drive client/subscription events from tests. Defined via
// `vi.hoisted` so the `vi.mock` factory (hoisted above imports) can see it.
const { FakeCentrifuge } = vi.hoisted(() => {
  type Handler = (ctx?: unknown) => void;

  class FakeSubscription {
    handlers = new Map<string, Handler[]>();
    subscribeCalled = false;
    unsubscribeCalled = false;
    removedListeners = false;
    constructor(
      public channel: string,
      public options: { since?: { offset: number; epoch: string } },
    ) {}
    on(event: string, handler: Handler) {
      const list = this.handlers.get(event) ?? [];
      list.push(handler);
      this.handlers.set(event, list);
      return this;
    }
    emit(event: string, ctx?: unknown) {
      (this.handlers.get(event) ?? []).forEach((handler) => handler(ctx));
    }
    subscribe() {
      this.subscribeCalled = true;
    }
    unsubscribe() {
      this.unsubscribeCalled = true;
    }
    removeAllListeners() {
      this.removedListeners = true;
    }
  }

  class FakeCentrifuge {
    static last: FakeCentrifuge | undefined;
    state = "disconnected";
    handlers = new Map<string, Handler[]>();
    subscriptions = new Map<string, FakeSubscription>();
    removed: FakeSubscription[] = [];
    /** Cumulative newSubscription calls per channel — the fan-out open count. */
    openCounts = new Map<string, number>();
    connectCalled = false;
    disconnectCalled = false;
    token: string | undefined;
    constructor(
      public url: string,
      public options: Record<string, unknown>,
    ) {
      FakeCentrifuge.last = this;
    }
    on(event: string, handler: Handler) {
      const list = this.handlers.get(event) ?? [];
      list.push(handler);
      this.handlers.set(event, list);
      return this;
    }
    emit(event: string, ctx?: unknown) {
      if (event === "connected" || event === "connecting" || event === "disconnected") {
        this.state = event;
      }
      (this.handlers.get(event) ?? []).forEach((handler) => handler(ctx));
    }
    connect() {
      this.connectCalled = true;
    }
    disconnect() {
      this.disconnectCalled = true;
      this.state = "disconnected";
    }
    setToken(token: string) {
      this.token = token;
    }
    newSubscription(channel: string, options: { since?: { offset: number; epoch: string } }) {
      if (this.subscriptions.has(channel)) throw new Error("duplicate");
      const subscription = new FakeSubscription(channel, options);
      this.subscriptions.set(channel, subscription);
      this.openCounts.set(channel, (this.openCounts.get(channel) ?? 0) + 1);
      return subscription;
    }
    removeSubscription(subscription: FakeSubscription) {
      this.subscriptions.delete(subscription.channel);
      this.removed.push(subscription);
    }
  }

  return { FakeCentrifuge };
});

vi.mock("centrifuge", () => ({ Centrifuge: FakeCentrifuge }));

function lastClient() {
  const client = FakeCentrifuge.last;
  if (!client) throw new Error("no FakeCentrifuge constructed");
  return client;
}

describe("createCentrifugeRealtime", () => {
  beforeEach(() => {
    FakeCentrifuge.last = undefined;
  });

  it("passes url and tuning options to the SDK", () => {
    createCentrifugeRealtime({
      url: "wss://rt.example/connection/websocket",
      timeoutMs: 5000,
      minReconnectDelayMs: 500,
      maxReconnectDelayMs: 20_000,
    });
    const sdk = lastClient();
    expect(sdk.url).toBe("wss://rt.example/connection/websocket");
    expect(sdk.options).toMatchObject({
      timeout: 5000,
      minReconnectDelay: 500,
      maxReconnectDelay: 20_000,
    });
  });

  it("adapts getToken: null becomes the anonymous empty token", async () => {
    createCentrifugeRealtime({ url: "wss://x", getToken: () => null });
    const getToken = lastClient().options.getToken as () => Promise<string>;
    await expect(getToken()).resolves.toBe("");
  });

  it("maps SDK connection events onto contract state changes", () => {
    const realtime = createCentrifugeRealtime({ url: "wss://x" });
    const states: string[] = [];
    realtime.onStateChange((state) => states.push(state));

    lastClient().emit("connecting");
    lastClient().emit("connected");
    lastClient().emit("disconnected");

    expect(states).toEqual(["connecting", "connected", "disconnected"]);
    expect(realtime.getState()).toBe("disconnected");
  });

  it("delivers publications with a composed stream position", () => {
    const realtime = createCentrifugeRealtime({ url: "wss://x" });
    const onPublication = vi.fn();
    realtime.subscribe("job:a", { onPublication });
    const subscription = lastClient().subscriptions.get("job:a")!;

    subscription.emit("subscribed", {
      wasRecovering: false,
      recovered: false,
      streamPosition: { offset: 1, epoch: "e9" },
    });
    subscription.emit("publication", { data: { progress: 40 }, offset: 2 });

    expect(onPublication).toHaveBeenCalledWith({
      data: { progress: 40 },
      position: { offset: 2, epoch: "e9" },
    });
  });

  it("surfaces recovery outcomes through onSubscribed", () => {
    const realtime = createCentrifugeRealtime({ url: "wss://x" });
    const onSubscribed = vi.fn();
    realtime.subscribe(
      "job:a",
      { onPublication: vi.fn(), onSubscribed },
      { since: { offset: 4, epoch: "e1" } },
    );
    const subscription = lastClient().subscriptions.get("job:a")!;
    expect(subscription.options.since).toEqual({ offset: 4, epoch: "e1" });

    subscription.emit("subscribed", { wasRecovering: true, recovered: false });
    expect(onSubscribed).toHaveBeenCalledWith({
      channel: "job:a",
      // The vendor really (re)subscribed, so every consumer sees `opened`.
      origin: "opened",
      wasRecovering: true,
      recovered: false,
      position: undefined,
    });
  });

  it("fans one SDK subscription out to several consumers and frees it after the last", async () => {
    const realtime = createCentrifugeRealtime({ url: "wss://x" });
    const first = vi.fn();
    const second = vi.fn();
    const a = realtime.subscribe("job:a", { onPublication: first });
    const b = realtime.subscribe("job:a", { onPublication: second });

    // One SDK subscription, however many consumers — which is what keeps the
    // per-channel subscription token (app adapter) minted once per channel.
    expect(lastClient().openCounts.get("job:a")).toBe(1);
    lastClient()
      .subscriptions.get("job:a")!
      .emit("publication", { data: { progress: 1 } });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);

    a.unsubscribe();
    await flushTeardown();
    expect(lastClient().removed).toHaveLength(0);

    b.unsubscribe();
    // Teardown is deferred by one microtask (the StrictMode grace window), so
    // the removed list is EMPTY until it flushes — reading it synchronously
    // here is what used to pass and now would not.
    expect(lastClient().removed).toHaveLength(0);
    await flushTeardown();

    const fake = lastClient().removed[0]!;
    expect(fake.unsubscribeCalled).toBe(true);
    expect(fake.removedListeners).toBe(true);
    expect(() => realtime.subscribe("job:a", { onPublication: vi.fn() })).not.toThrow();
    expect(lastClient().openCounts.get("job:a")).toBe(2);
  });

  it("disconnect tears down every subscription then the connection", () => {
    const realtime = createCentrifugeRealtime({ url: "wss://x" });
    realtime.subscribe("job:a", { onPublication: vi.fn() });
    realtime.subscribe("job:b", { onPublication: vi.fn() });

    realtime.disconnect();

    expect(lastClient().removed).toHaveLength(2);
    expect(lastClient().disconnectCalled).toBe(true);
  });

  it("setToken forwards rotation to the SDK (null → anonymous)", () => {
    const realtime = createCentrifugeRealtime({ url: "wss://x" });
    realtime.setToken("jwt-2");
    expect(lastClient().token).toBe("jwt-2");
    realtime.setToken(null);
    expect(lastClient().token).toBe("");
  });

  it("mints a per-channel subscription token once per channel, not per consumer", async () => {
    const getSubscriptionToken = vi.fn(async (channel: string) => `jwt-${channel}`);
    const realtime = createCentrifugeRealtime({ url: "wss://x", getSubscriptionToken });
    realtime.subscribe("org:1", { onPublication: vi.fn() });
    realtime.subscribe("org:1", { onPublication: vi.fn() });

    // The SDK owns the calling — fan-out's job is that there is only ONE
    // subscription to own it, so a second consumer costs no extra token round
    // trip against `POST /v1/realtime/subscribe-token`.
    expect(lastClient().openCounts.get("org:1")).toBe(1);
    const options = lastClient().subscriptions.get("org:1")!.options as {
      getToken?: () => Promise<string>;
    };
    await expect(options.getToken?.()).resolves.toBe("jwt-org:1");
    expect(getSubscriptionToken).toHaveBeenCalledTimes(1);
  });

  it("omits the subscription-token hook when the app doesn't supply one", () => {
    const realtime = createCentrifugeRealtime({ url: "wss://x" });
    realtime.subscribe("org:1", { onPublication: vi.fn() });
    expect(lastClient().subscriptions.get("org:1")!.options).not.toHaveProperty("getToken");
  });
});

// The SAME behaviour table the mock and the no-op run (see fanout.test.ts),
// driven here through the real adapter over the SDK fake. This is what stops
// the mock — the thing every downstream app tests against — from drifting into
// semantics the shipped adapter does not have.
describeFanoutConformance({
  name: "centrifuge adapter",
  observable: true,
  create() {
    const client = createCentrifugeRealtime({ url: "wss://x" });
    const sdk = lastClient();
    const subscriptionFor = (channel: string) => {
      const subscription = sdk.subscriptions.get(channel);
      if (!subscription) throw new Error(`no SDK subscription for "${channel}"`);
      return subscription;
    };
    return {
      client,
      openCount: (channel) => sdk.openCounts.get(channel) ?? 0,
      isOpen: (channel) => sdk.subscriptions.has(channel),
      emit: (channel, data, position) =>
        subscriptionFor(channel).emit("publication", { data, offset: position?.offset }),
      emitError: (channel, error) =>
        subscriptionFor(channel).emit("error", { error: { message: error.message } }),
      // Unlike the mock, the SDK reports `subscribed` asynchronously — the
      // server round trip. Tests that need a live channel drive it explicitly.
      settle: (channel) =>
        subscriptionFor(channel).emit("subscribed", {
          wasRecovering: false,
          recovered: false,
          streamPosition: { offset: 1, epoch: "e1" },
        }),
      resubscribe: (channel) =>
        subscriptionFor(channel).emit("subscribed", { wasRecovering: true, recovered: true }),
    };
  },
});
