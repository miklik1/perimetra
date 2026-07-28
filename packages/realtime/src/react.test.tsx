import { act, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";

import { flushTeardown } from "./fanout-conformance";
import { createMockRealtime } from "./mock";
import { useChannel, useConnectionState } from "./react";
import { RealtimeContractError, type RealtimeClient } from "./types";

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

  it("lets a second component on the SAME channel receive every message", () => {
    // The bug this hook used to have: the adapter threw on the duplicate, the
    // effect caught it, and this second consumer silently got nothing — no
    // error, no boundary, no failing test, just a channel that never updated.
    const realtime = createMockRealtime();
    const first = vi.fn();
    const second = vi.fn();
    renderHook(() => useChannel(realtime, "org:1", { onPublication: first }));
    renderHook(() => useChannel(realtime, "org:1", { onPublication: second }));

    act(() => realtime.emit("org:1", { counts: 3 }));

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(realtime.consumerCount("org:1")).toBe(2);
    expect(realtime.openCount("org:1")).toBe(1);
  });

  it("lets a subscribe throw ESCAPE the effect instead of rerouting it to onError", () => {
    // THE DISARM TEST. Nothing else guards the deleted try/catch: restoring it
    // turns this red and leaves every other test in this file green, because a
    // caught throw is indistinguishable from a working subscription until some
    // message fails to arrive. After fan-out, "already subscribed" is not
    // reachable for the legitimate case; everything `subscribe` can still throw
    // (`since-conflict`, `double-release`) is a programming error that MUST
    // reach the nearest error boundary rather than being handed to a handler
    // whose job is transport errors.
    const onError = vi.fn();
    const failing: RealtimeClient = {
      ...createMockRealtime(),
      subscribe: () => {
        throw new RealtimeContractError("since-conflict", "org:1", "positions disagree");
      },
    };

    expect(() =>
      renderHook(() => useChannel(failing, "org:1", { onPublication: vi.fn(), onError })),
    ).toThrow(RealtimeContractError);
    expect(onError).not.toHaveBeenCalled();
  });

  it("StrictMode: one consumer opens the channel exactly once and receives once", async () => {
    const realtime = createMockRealtime();
    const onPublication = vi.fn();
    renderHook(() => useChannel(realtime, "org:1", { onPublication }), { wrapper: StrictMode });
    // React 19 runs mount → cleanup → mount in ONE flush. Without the fan-out
    // registry's deferred teardown the channel would close and re-open here.
    await act(async () => {
      await flushTeardown();
    });

    expect(realtime.openCount("org:1")).toBe(1);
    expect(realtime.consumerCount("org:1")).toBe(1);

    act(() => realtime.emit("org:1", { counts: 3 }));
    expect(onPublication).toHaveBeenCalledTimes(1);
  });

  it("the since-conflict crash is MOUNT-ORDER dependent, both orders pinned", () => {
    // A legitimate pattern this hook's own docs advertise as normal — two
    // components sharing a broadcast channel — becomes an error boundary trip
    // as soon as ONE of them passes `since`, and only in one of the two mount
    // orders. The throw itself is deliberate (an unmodelled case must fail
    // loud, and re-adding a catch here restores the silent-failure class this
    // package exists to remove); what was undocumented is the asymmetry. Both
    // orders are pinned so it is visible in the suite, and the error message
    // now names the reorder as the fix.
    const conflicting = createMockRealtime();
    let thrown: unknown;
    try {
      renderHook(() => {
        useChannel(conflicting, "org:1", { onPublication: vi.fn() });
        useChannel(
          conflicting,
          "org:1",
          { onPublication: vi.fn() },
          { since: { offset: 9, epoch: "e2" } },
        );
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(RealtimeContractError);
    expect((thrown as RealtimeContractError).code).toBe("since-conflict");
    expect((thrown as RealtimeContractError).message).toContain(
      "subscribing the since-bearing consumer first",
    );

    // Same two consumers, other order: the no-since one joins, no throw.
    const reordered = createMockRealtime();
    expect(() =>
      renderHook(() => {
        useChannel(
          reordered,
          "org:1",
          { onPublication: vi.fn() },
          { since: { offset: 9, epoch: "e2" } },
        );
        useChannel(reordered, "org:1", { onPublication: vi.fn() });
      }),
    ).not.toThrow();
    expect(reordered.consumerCount("org:1")).toBe(2);
    expect(reordered.openCount("org:1")).toBe(1);
  });

  it("StrictMode: a since-bearing consumer opens the channel exactly once", async () => {
    // The grace window used to be defeated for every since-bearing consumer:
    // the registry reaped a draining entry on ANY `since`, including one that
    // deep-equals the position the channel was opened with. Measured through
    // this hook: openCount 2 with `since`, 1 without — and on the Centrifugo
    // adapter, two `newSubscription` calls and two subscription-token mints for
    // one channel, on every StrictMode mount and every re-keyed remount.
    const realtime = createMockRealtime();
    const onPublication = vi.fn();
    renderHook(
      // A fresh `since` object every render, as a real caller re-reading its
      // stored position produces — deep equality is the rule, never identity.
      () => useChannel(realtime, "org:1", { onPublication }, { since: { offset: 4, epoch: "e1" } }),
      { wrapper: StrictMode },
    );
    await act(async () => {
      await flushTeardown();
    });

    expect(realtime.openCount("org:1")).toBe(1);
    expect(realtime.consumerCount("org:1")).toBe(1);
    expect(realtime.subscribedSince("org:1")).toEqual({ offset: 4, epoch: "e1" });

    act(() => realtime.emit("org:1", { counts: 3 }));
    expect(onPublication).toHaveBeenCalledTimes(1);
  });

  it("StrictMode: two consumers on one channel give two consumers, one open, one delivery each", async () => {
    const realtime = createMockRealtime();
    const first = vi.fn();
    const second = vi.fn();
    renderHook(
      () => {
        useChannel(realtime, "org:1", { onPublication: first });
        useChannel(realtime, "org:1", { onPublication: second });
      },
      { wrapper: StrictMode },
    );
    await act(async () => {
      await flushTeardown();
    });

    expect(realtime.consumerCount("org:1")).toBe(2);
    expect(realtime.openCount("org:1")).toBe(1);

    act(() => realtime.emit("org:1", { counts: 3 }));
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("swapping the sole consumer in one commit keeps the channel open", async () => {
    const realtime = createMockRealtime();
    const { rerender } = renderHook(
      ({ handler }: { handler: () => void }) =>
        // A new key/identity for the consuming component, same channel: cleanup
        // and setup land in the same flush, so the channel must not churn.
        useChannel(realtime, "org:1", { onPublication: handler }),
      { initialProps: { handler: vi.fn() } },
    );

    rerender({ handler: vi.fn() });
    await act(async () => {
      await flushTeardown();
    });

    expect(realtime.openCount("org:1")).toBe(1);
  });
});
