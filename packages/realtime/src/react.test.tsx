import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createMockRealtime } from "./mock";
import { useChannel, useConnectionState } from "./react";

describe("useConnectionState", () => {
  it("tracks the client's connection state", () => {
    const realtime = createMockRealtime();
    const { result } = renderHook(() => useConnectionState(realtime));
    expect(result.current).toBe("connected");

    act(() => realtime.setState("disconnected"));
    expect(result.current).toBe("disconnected");
  });
});

describe("useChannel", () => {
  it("subscribes on mount and unsubscribes on unmount", () => {
    const realtime = createMockRealtime();
    const onPublication = vi.fn();
    const { unmount } = renderHook(() => useChannel(realtime, "job:a", { onPublication }));

    expect(realtime.activeChannels()).toEqual(["job:a"]);
    act(() => realtime.emit("job:a", { progress: 10 }));
    expect(onPublication).toHaveBeenCalledWith({ data: { progress: 10 }, position: undefined });

    unmount();
    expect(realtime.activeChannels()).toEqual([]);
  });

  it("skips subscribing for a null channel and subscribes when it appears", () => {
    const realtime = createMockRealtime();
    const onPublication = vi.fn();
    const { rerender } = renderHook(
      ({ channel }: { channel: string | null }) => useChannel(realtime, channel, { onPublication }),
      { initialProps: { channel: null as string | null } },
    );
    expect(realtime.activeChannels()).toEqual([]);

    rerender({ channel: "job:a" });
    expect(realtime.activeChannels()).toEqual(["job:a"]);
  });

  it("does not resubscribe when handler identity changes", () => {
    const realtime = createMockRealtime();
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(
      ({ handler }: { handler: () => void }) =>
        useChannel(realtime, "job:a", { onPublication: handler }),
      { initialProps: { handler: first } },
    );

    rerender({ handler: second });
    act(() => realtime.emit("job:a", { done: true }));

    // Latest handler receives the event; the subscription never churned.
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("moves the subscription when the channel changes", () => {
    const realtime = createMockRealtime();
    const onPublication = vi.fn();
    const { rerender } = renderHook(
      ({ channel }: { channel: string }) => useChannel(realtime, channel, { onPublication }),
      { initialProps: { channel: "job:a" } },
    );

    rerender({ channel: "job:b" });
    expect(realtime.activeChannels()).toEqual(["job:b"]);
  });

  it("passes the since option through to the subscription", () => {
    const realtime = createMockRealtime();
    renderHook(() =>
      useChannel(
        realtime,
        "job:a",
        { onPublication: vi.fn() },
        { since: { offset: 5, epoch: "e1" } },
      ),
    );
    expect(realtime.subscribedSince("job:a")).toEqual({ offset: 5, epoch: "e1" });
  });
});
