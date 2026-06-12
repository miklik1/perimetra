import { beforeEach, describe, expect, it, vi } from "vitest";

import { createCentrifugeRealtime } from "./centrifuge";

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
      wasRecovering: true,
      recovered: false,
      position: undefined,
    });
  });

  it("throws on duplicate channel subscribe and frees the channel on unsubscribe", () => {
    const realtime = createCentrifugeRealtime({ url: "wss://x" });
    const subscription = realtime.subscribe("job:a", { onPublication: vi.fn() });
    expect(() => realtime.subscribe("job:a", { onPublication: vi.fn() })).toThrow(
      /Already subscribed/,
    );

    subscription.unsubscribe();
    const fake = lastClient().removed[0]!;
    expect(fake.unsubscribeCalled).toBe(true);
    expect(fake.removedListeners).toBe(true);
    expect(() => realtime.subscribe("job:a", { onPublication: vi.fn() })).not.toThrow();
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
});
