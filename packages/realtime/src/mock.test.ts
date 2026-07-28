import { describe, expect, it, vi } from "vitest";

import { createMockRealtime } from "./mock";
import { createNoopRealtime } from "./noop";

describe("createMockRealtime", () => {
  it("delivers publications to the subscribed channel only", () => {
    const realtime = createMockRealtime();
    const onA = vi.fn();
    const onB = vi.fn();
    realtime.subscribe("job:a", { onPublication: onA });
    realtime.subscribe("job:b", { onPublication: onB });

    realtime.emit("job:a", { progress: 50 }, { offset: 3, epoch: "e1" });

    expect(onA).toHaveBeenCalledWith({
      data: { progress: 50 },
      position: { offset: 3, epoch: "e1" },
    });
    expect(onB).not.toHaveBeenCalled();
  });

  it("fires onSubscribed immediately when connected", () => {
    const realtime = createMockRealtime();
    const onSubscribed = vi.fn();
    realtime.subscribe("job:a", { onPublication: vi.fn(), onSubscribed });

    expect(onSubscribed).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "job:a", wasRecovering: false }),
    );
  });

  it("queues subscriptions while disconnected and activates on connect", () => {
    const realtime = createMockRealtime({ initialState: "disconnected" });
    const onSubscribed = vi.fn();
    realtime.subscribe("job:a", { onPublication: vi.fn(), onSubscribed });
    expect(onSubscribed).not.toHaveBeenCalled();

    realtime.setState("connected");
    expect(onSubscribed).toHaveBeenCalledTimes(1);
  });

  it("re-fires onSubscribed after a drop and reconnect", () => {
    const realtime = createMockRealtime();
    const onSubscribed = vi.fn();
    realtime.subscribe("job:a", { onPublication: vi.fn(), onSubscribed });

    realtime.setState("disconnected");
    realtime.setState("connected");

    expect(onSubscribed).toHaveBeenCalledTimes(2);
  });

  it("reports a recovering context when subscribed with `since`", () => {
    const realtime = createMockRealtime();
    const onSubscribed = vi.fn();
    realtime.subscribe(
      "job:a",
      { onPublication: vi.fn(), onSubscribed },
      { since: { offset: 7, epoch: "e1" } },
    );

    expect(onSubscribed).toHaveBeenCalledWith(
      expect.objectContaining({ wasRecovering: true, recovered: true }),
    );
    expect(realtime.subscribedSince("job:a")).toEqual({ offset: 7, epoch: "e1" });
  });

  it("reports the position the stream REACHED on reconnect, not the one it opened with", () => {
    // The mock/adapter divergence, pinned at the mock. `subscribed` fires on
    // every (re)connect, and Centrifugo's `ctx.streamPosition` is the server's
    // CURRENT position — so a mock that reports its `since` forever rewinds the
    // channel on every reconnect (measured: 9 back to 4). Because the registry
    // replays its tracked position to late joiners, that rewind escaped the
    // mock's own consumer and reached any second one.
    const realtime = createMockRealtime();
    const onSubscribed = vi.fn();
    realtime.subscribe(
      "job:a",
      { onPublication: vi.fn(), onSubscribed },
      { since: { offset: 4, epoch: "e1" } },
    );
    expect(onSubscribed.mock.calls[0]?.[0]?.position).toEqual({ offset: 4, epoch: "e1" });

    realtime.emit("job:a", { n: 1 }, { offset: 9, epoch: "e1" });
    realtime.setState("disconnected");
    realtime.setState("connected");

    expect(onSubscribed).toHaveBeenCalledTimes(2);
    expect(onSubscribed.mock.calls[1]?.[0]?.position).toEqual({ offset: 9, epoch: "e1" });
  });

  it("lets tests script a failed recovery", () => {
    const realtime = createMockRealtime({
      subscribedContext: () => ({ wasRecovering: true, recovered: false }),
    });
    const onSubscribed = vi.fn();
    realtime.subscribe("job:a", { onPublication: vi.fn(), onSubscribed });

    expect(onSubscribed).toHaveBeenCalledWith(
      expect.objectContaining({ wasRecovering: true, recovered: false }),
    );
  });

  it("fans a second subscription on the same channel out to both consumers", () => {
    // This used to throw "Already subscribed" — the contract rule that made a
    // second legitimate consumer of a shared broadcast channel impossible.
    const realtime = createMockRealtime();
    const first = vi.fn();
    const second = vi.fn();
    realtime.subscribe("job:a", { onPublication: first });
    realtime.subscribe("job:a", { onPublication: second });

    realtime.emit("job:a", { progress: 50 });

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(realtime.consumerCount("job:a")).toBe(2);
    expect(realtime.openCount("job:a")).toBe(1);
  });

  it("unsubscribe stops delivery and frees the channel", () => {
    const realtime = createMockRealtime();
    const onPublication = vi.fn();
    const subscription = realtime.subscribe("job:a", { onPublication });

    subscription.unsubscribe();
    realtime.emit("job:a", { progress: 100 });

    expect(onPublication).not.toHaveBeenCalled();
    expect(realtime.activeChannels()).toEqual([]);
    // The channel can be re-subscribed after unsubscribe.
    expect(() => realtime.subscribe("job:a", { onPublication })).not.toThrow();
  });

  it("notifies state listeners and supports unlisten", () => {
    const realtime = createMockRealtime();
    const listener = vi.fn();
    const unlisten = realtime.onStateChange(listener);

    realtime.setState("disconnected");
    expect(listener).toHaveBeenCalledWith("disconnected");

    unlisten();
    realtime.setState("connected");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("disconnect clears all subscriptions", () => {
    const realtime = createMockRealtime();
    realtime.subscribe("job:a", { onPublication: vi.fn() });
    realtime.disconnect();
    expect(realtime.activeChannels()).toEqual([]);
    expect(realtime.getState()).toBe("disconnected");
  });
});

describe("createNoopRealtime", () => {
  it("accepts every call and delivers nothing", () => {
    const realtime = createNoopRealtime();
    expect(realtime.getState()).toBe("disconnected");
    const subscription = realtime.subscribe("job:a", { onPublication: vi.fn() });
    expect(subscription.channel).toBe("job:a");
    expect(() => {
      realtime.connect();
      realtime.setToken("t");
      subscription.unsubscribe();
      realtime.onStateChange(vi.fn())();
      realtime.disconnect();
    }).not.toThrow();
  });
});
