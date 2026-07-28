import { describe, expect, it, vi } from "vitest";

import {
  RealtimeContractError,
  type RealtimeClient,
  type RealtimePublication,
  type RealtimeSubscription,
  type StreamPosition,
  type SubscribedContext,
} from "./types";

/**
 * The fan-out behaviour table, written ONCE and run against every adapter
 * (`mock.ts`, `noop.ts`, and the Centrifugo adapter over its SDK fake).
 *
 * Test-only helper — it is imported exclusively by `*.test.ts` files and is not
 * on the package's `exports` map. It exists because the mock is what every
 * downstream app tests against: if the mock's semantics can drift from the real
 * adapters', every one of those app tests is measuring a fiction. Running the
 * same assertions through all three makes that drift impossible.
 */

/** One microtask — the fan-out registry's teardown grace window. */
export function flushTeardown(): Promise<void> {
  return Promise.resolve();
}

/**
 * Adapter-specific driving. When `observable` is false (the no-op adapter, which
 * by construction has no vendor side at all) the vendor-facing members are
 * inert and the vendor-observable tests are SKIPPED rather than passing
 * vacuously.
 */
interface FanoutHarness {
  client: RealtimeClient;
  /** Cumulative `adapter.open()` calls for a channel, over the client's life. */
  openCount(channel: string): number;
  /** True while the channel's vendor subscription is open. */
  isOpen(channel: string): boolean;
  /** Push a publication into the open channel. */
  emit(channel: string, data: unknown, position?: StreamPosition): void;
  /** Push a subscription error into the open channel. */
  emitError(channel: string, error: Error): void;
  /**
   * Make the FIRST real vendor `subscribed` happen, if the adapter has not
   * already delivered it from `open` (the mock has; the SDK has not).
   */
  settle(channel: string): void;
  /** Make ANOTHER real vendor `subscribed` happen — a reconnect. */
  resubscribe(channel: string): void;
}

export interface FanoutConformanceOptions {
  name: string;
  /** False when the adapter has no vendor side to inspect or drive. */
  observable: boolean;
  create(): FanoutHarness;
}

const CHANNEL = "org:1";
const OTHER = { offset: 9, epoch: "e2" } as const;

/** A handlers bag that records everything it is given. */
function recorder() {
  const publications: RealtimePublication<unknown>[] = [];
  const contexts: SubscribedContext[] = [];
  const errors: Error[] = [];
  return {
    publications,
    contexts,
    errors,
    handlers: {
      onPublication: (publication: RealtimePublication<unknown>) => publications.push(publication),
      onSubscribed: (context: SubscribedContext) => contexts.push(context),
      onError: (error: Error) => errors.push(error),
    },
  };
}

export function describeFanoutConformance({
  name,
  observable,
  create,
}: FanoutConformanceOptions): void {
  describe(`fan-out conformance — ${name}`, () => {
    // ---------------------------------------------------------------------
    // Rules observable through the contract alone — every adapter runs these.
    // ---------------------------------------------------------------------

    it("accepts a second consumer on a live channel instead of throwing", () => {
      const { client } = create();
      client.subscribe(CHANNEL, recorder().handlers);
      expect(() => client.subscribe(CHANNEL, recorder().handlers)).not.toThrow();
    });

    it("throws `since-conflict` when two live consumers disagree about the position", () => {
      const { client } = create();
      client.subscribe(CHANNEL, recorder().handlers, { since: { offset: 4, epoch: "e1" } });

      let thrown: unknown;
      try {
        client.subscribe(CHANNEL, recorder().handlers, { since: OTHER });
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(RealtimeContractError);
      const error = thrown as RealtimeContractError;
      expect(error.code).toBe("since-conflict");
      expect(error.channel).toBe(CHANNEL);
      // The message must name BOTH positions and the way out.
      expect(error.message).toContain("offset 4");
      expect(error.message).toContain("offset 9");
      expect(error.message).toContain("its own channel");
    });

    it("makes the since-conflict message name the MOUNT-ORDER way out", () => {
      const { client } = create();
      client.subscribe(CHANNEL, recorder().handlers);

      let thrown: unknown;
      try {
        client.subscribe(CHANNEL, recorder().handlers, { since: OTHER });
      } catch (error) {
        thrown = error;
      }

      // Whether this pair throws depends purely on which consumer mounted
      // first, and nothing else in the system tells the reader that. A message
      // that only says "one stream position" leaves the one-line fix — reorder
      // — undiscoverable.
      const message = (thrown as RealtimeContractError).message;
      expect(message).toContain("MOUNT-ORDER");
      expect(message).toContain("subscribing the since-bearing consumer first");
    });

    it("throws on [no-since, since] and NOT on [since, no-since] — the asymmetry, pinned", () => {
      // Two consumers sharing a broadcast channel is the case this package
      // advertises as normal; one of them adding a `since` turns the pair into
      // a crash whose existence depends on mount order. Both orders are pinned
      // here so the asymmetry is visible in the suite rather than discovered in
      // production. This is NOT a bug being frozen: an unmodelled case failing
      // loud is the design bar, and the order-dependence is documented in the
      // fan-out ADR's "what is not modelled" section.
      const first = create();
      first.client.subscribe(CHANNEL, recorder().handlers);
      expect(() => first.client.subscribe(CHANNEL, recorder().handlers, { since: OTHER })).toThrow(
        RealtimeContractError,
      );

      const second = create();
      second.client.subscribe(CHANNEL, recorder().handlers, { since: OTHER });
      expect(() => second.client.subscribe(CHANNEL, recorder().handlers)).not.toThrow();
    });

    it("joins without throwing when the second `since` deep-equals the first", () => {
      const { client } = create();
      client.subscribe(CHANNEL, recorder().handlers, { since: { offset: 4, epoch: "e1" } });
      // A distinct object with the same value — the rule is deep equality, not
      // identity, because a caller re-reads its stored position each render.
      expect(() =>
        client.subscribe(CHANNEL, recorder().handlers, { since: { offset: 4, epoch: "e1" } }),
      ).not.toThrow();
    });

    it("does not throw when a `since` lands on a channel with no live consumers", () => {
      const { client } = create();
      client
        .subscribe(CHANNEL, recorder().handlers, { since: { offset: 4, epoch: "e1" } })
        .unsubscribe();
      expect(() => client.subscribe(CHANNEL, recorder().handlers, { since: OTHER })).not.toThrow();
    });

    it("throws `double-release` on a second unsubscribe", () => {
      const { client } = create();
      const subscription = client.subscribe(CHANNEL, recorder().handlers);
      subscription.unsubscribe();

      let thrown: unknown;
      try {
        subscription.unsubscribe();
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(RealtimeContractError);
      expect((thrown as RealtimeContractError).code).toBe("double-release");
      expect((thrown as RealtimeContractError).channel).toBe(CHANNEL);
    });

    it("is silent when unsubscribe follows disconnect", () => {
      const { client } = create();
      const subscription = client.subscribe(CHANNEL, recorder().handlers);
      // React tears the provider down BEFORE its children, so disconnect really
      // does run first. Making this loud would throw on every app teardown.
      client.disconnect();
      expect(() => subscription.unsubscribe()).not.toThrow();
    });

    it("still throws `double-release` after a disconnect", () => {
      const { client } = create();
      const subscription = client.subscribe(CHANNEL, recorder().handlers);
      client.disconnect();
      subscription.unsubscribe();
      // Tracked by the per-handle flag, NOT by "the entry is gone" — otherwise
      // the silent case above would swallow this one too.
      expect(() => subscription.unsubscribe()).toThrow(RealtimeContractError);
    });

    // ---------------------------------------------------------------------
    // Rules that need the vendor side. Skipped, not faked, where absent.
    // ---------------------------------------------------------------------

    describe.skipIf(!observable)("vendor subscription lifecycle", () => {
      it("opens exactly one vendor subscription for two consumers", () => {
        const harness = create();
        harness.client.subscribe(CHANNEL, recorder().handlers);
        harness.client.subscribe(CHANNEL, recorder().handlers);

        expect(harness.openCount(CHANNEL)).toBe(1);
        expect(harness.isOpen(CHANNEL)).toBe(true);
      });

      it("keeps the vendor subscription when one of two consumers leaves", async () => {
        const harness = create();
        const first = harness.client.subscribe(CHANNEL, recorder().handlers);
        harness.client.subscribe(CHANNEL, recorder().handlers);

        first.unsubscribe();
        await flushTeardown();

        expect(harness.isOpen(CHANNEL)).toBe(true);
        expect(harness.openCount(CHANNEL)).toBe(1);
      });

      it("closes the channel a microtask after the LAST consumer leaves", async () => {
        const harness = create();
        const only = harness.client.subscribe(CHANNEL, recorder().handlers);

        only.unsubscribe();
        // Still open synchronously — the grace window is the whole point.
        expect(harness.isOpen(CHANNEL)).toBe(true);

        await flushTeardown();
        expect(harness.isOpen(CHANNEL)).toBe(false);
      });

      it("a StrictMode-shaped remount of a sole consumer opens once", async () => {
        const harness = create();
        // React 19 runs every cleanup and then every setup in ONE flush.
        const first = harness.client.subscribe(CHANNEL, recorder().handlers);
        first.unsubscribe();
        harness.client.subscribe(CHANNEL, recorder().handlers);

        await flushTeardown();
        expect(harness.openCount(CHANNEL)).toBe(1);
        expect(harness.isOpen(CHANNEL)).toBe(true);
      });

      it("a StrictMode-shaped remount of TWO consumers opens once and keeps both", async () => {
        const harness = create();
        const a1 = harness.client.subscribe(CHANNEL, recorder().handlers);
        const b1 = harness.client.subscribe(CHANNEL, recorder().handlers);
        a1.unsubscribe();
        b1.unsubscribe();
        harness.client.subscribe(CHANNEL, recorder().handlers);
        harness.client.subscribe(CHANNEL, recorder().handlers);

        await flushTeardown();
        expect(harness.openCount(CHANNEL)).toBe(1);
        expect(harness.isOpen(CHANNEL)).toBe(true);
      });

      it("a sole consumer replaced in one commit opens once", async () => {
        const harness = create();
        const outgoing = harness.client.subscribe(CHANNEL, recorder().handlers);
        outgoing.unsubscribe();
        harness.client.subscribe(CHANNEL, recorder().handlers);
        await flushTeardown();

        expect(harness.openCount(CHANNEL)).toBe(1);
      });

      it("a StrictMode-shaped remount of a SINCE-BEARING sole consumer opens once", async () => {
        const harness = create();
        const since = { offset: 4, epoch: "e1" };
        const first = harness.client.subscribe(CHANNEL, recorder().handlers, { since });
        first.unsubscribe();
        // A distinct object with the same value — a caller re-reads its stored
        // position each render, so identity is never the test.
        harness.client.subscribe(CHANNEL, recorder().handlers, { since: { ...since } });

        await flushTeardown();
        // The grace window used to be defeated for EVERY since-bearing consumer:
        // the reap-on-`since` rule fired on any `since`, including one that
        // deep-equals `openedSince`. A deep-equal `since` joins the pending
        // entry and cancels its teardown, exactly like the no-since path.
        expect(harness.openCount(CHANNEL)).toBe(1);
        expect(harness.isOpen(CHANNEL)).toBe(true);
      });

      it("never replays a late joiner a position the channel has already passed", async () => {
        // A reconnect must not rewind the registry's tracked position. The mock
        // used to report the position it OPENED with on every (re)connect, so
        // the rewind escaped its own consumer and reached the next one to join.
        const harness = create();
        harness.client.subscribe(CHANNEL, recorder().handlers, {
          since: { offset: 4, epoch: "e1" },
        });
        harness.settle(CHANNEL);
        harness.emit(CHANNEL, { n: 1 }, { offset: 9, epoch: "e1" });

        harness.resubscribe(CHANNEL);

        const joiner = recorder();
        harness.client.subscribe(CHANNEL, joiner.handlers);
        expect(joiner.contexts[0]?.position).toEqual({ offset: 9, epoch: "e1" });
      });

      it("re-opens at the new position when a `since` lands on a consumer-less channel", async () => {
        const harness = create();
        harness.client
          .subscribe(CHANNEL, recorder().handlers, { since: { offset: 4, epoch: "e1" } })
          .unsubscribe();

        harness.client.subscribe(CHANNEL, recorder().handlers, { since: OTHER });
        await flushTeardown();

        // Reaped and re-opened, not joined: the second consumer asked for a
        // different position and nobody was left to disagree with it.
        expect(harness.openCount(CHANNEL)).toBe(2);
        expect(harness.isOpen(CHANNEL)).toBe(true);
      });

      it("re-opens after a full teardown", async () => {
        const harness = create();
        harness.client.subscribe(CHANNEL, recorder().handlers).unsubscribe();
        await flushTeardown();
        expect(harness.isOpen(CHANNEL)).toBe(false);

        harness.client.subscribe(CHANNEL, recorder().handlers);
        expect(harness.openCount(CHANNEL)).toBe(2);
        expect(harness.isOpen(CHANNEL)).toBe(true);
      });

      it("disconnect closes every open channel", async () => {
        const harness = create();
        harness.client.subscribe(CHANNEL, recorder().handlers);
        harness.client.subscribe("user:1", recorder().handlers);

        harness.client.disconnect();

        expect(harness.isOpen(CHANNEL)).toBe(false);
        expect(harness.isOpen("user:1")).toBe(false);
      });
    });

    describe.skipIf(!observable)("delivery", () => {
      it("fans every publication out to every consumer", () => {
        const harness = create();
        const a = recorder();
        const b = recorder();
        harness.client.subscribe(CHANNEL, a.handlers);
        harness.client.subscribe(CHANNEL, b.handlers);
        harness.settle(CHANNEL);

        harness.emit(CHANNEL, { n: 1 }, { offset: 1, epoch: "e1" });
        harness.emit(CHANNEL, { n: 2 }, { offset: 2, epoch: "e1" });

        expect(a.publications.map((p) => p.data)).toEqual([{ n: 1 }, { n: 2 }]);
        expect(b.publications.map((p) => p.data)).toEqual([{ n: 1 }, { n: 2 }]);
      });

      it("two consumers sharing ONE handlers object both receive every message", () => {
        const harness = create();
        // A `Set<handlers>` would silently dedupe these two — the same defect
        // class as the throw this registry replaced, one level down.
        const onPublication = vi.fn();
        const shared = { onPublication };
        harness.client.subscribe(CHANNEL, shared);
        harness.client.subscribe(CHANNEL, shared);
        harness.settle(CHANNEL);

        harness.emit(CHANNEL, { n: 1 });

        expect(onPublication).toHaveBeenCalledTimes(2);
      });

      it("stops delivering to a consumer that left and keeps delivering to the rest", async () => {
        const harness = create();
        const a = recorder();
        const b = recorder();
        const first = harness.client.subscribe(CHANNEL, a.handlers);
        harness.client.subscribe(CHANNEL, b.handlers);
        harness.settle(CHANNEL);

        first.unsubscribe();
        await flushTeardown();
        harness.emit(CHANNEL, { n: 1 });

        expect(a.publications).toHaveLength(0);
        expect(b.publications.map((p) => p.data)).toEqual([{ n: 1 }]);
      });

      it("delivers the in-flight message to a consumer dropped mid-delivery, and none after", () => {
        const harness = create();
        const dropped = recorder();
        let droppedSubscription: RealtimeSubscription | undefined = undefined;
        let dropOnce = true;
        harness.client.subscribe(CHANNEL, {
          // Fan-out iterates a SNAPSHOT, so a handler may (un)subscribe during
          // delivery without corrupting the iteration — and the consumer it
          // drops still receives the message already in flight.
          onPublication: () => {
            if (!dropOnce) return;
            dropOnce = false;
            droppedSubscription?.unsubscribe();
          },
        });
        droppedSubscription = harness.client.subscribe(CHANNEL, dropped.handlers);
        harness.settle(CHANNEL);

        harness.emit(CHANNEL, { n: 1 });
        expect(dropped.publications.map((p) => p.data)).toEqual([{ n: 1 }]);

        harness.emit(CHANNEL, { n: 2 });
        expect(dropped.publications.map((p) => p.data)).toEqual([{ n: 1 }]);
        // The dropped consumer's own unsubscribe already happened, so releasing
        // it again is the double-release case, not a second cleanup.
        expect(() => droppedSubscription?.unsubscribe()).toThrow(RealtimeContractError);
      });

      it("fans errors out to every consumer", () => {
        const harness = create();
        const a = recorder();
        const b = recorder();
        harness.client.subscribe(CHANNEL, a.handlers);
        harness.client.subscribe(CHANNEL, b.handlers);
        harness.settle(CHANNEL);

        harness.emitError(CHANNEL, new Error("boom"));

        expect(a.errors.map((e) => e.message)).toEqual(["boom"]);
        expect(b.errors.map((e) => e.message)).toEqual(["boom"]);
      });

      it("fans a reconnect out to every consumer as `opened`", () => {
        const harness = create();
        const a = recorder();
        const b = recorder();
        harness.client.subscribe(CHANNEL, a.handlers);
        harness.client.subscribe(CHANNEL, b.handlers);
        harness.settle(CHANNEL);
        const before = { a: a.contexts.length, b: b.contexts.length };

        harness.resubscribe(CHANNEL);

        expect(a.contexts.length).toBe(before.a + 1);
        expect(b.contexts.length).toBe(before.b + 1);
        expect(a.contexts.at(-1)?.origin).toBe("opened");
        expect(b.contexts.at(-1)?.origin).toBe("opened");
      });

      it("gives the opener `opened` and a late joiner `joined` at the current position", () => {
        const harness = create();
        const opener = recorder();
        harness.client.subscribe(CHANNEL, opener.handlers);
        harness.settle(CHANNEL);

        // ORDERING GUARD: adapters may deliver `subscribed` synchronously from
        // open (the mock does). Consumer #1 only sees its own onSubscribed
        // because the registry inserts it BEFORE calling adapter.open().
        expect(opener.contexts).toHaveLength(1);
        expect(opener.contexts[0]?.origin).toBe("opened");
        expect(opener.contexts[0]?.channel).toBe(CHANNEL);

        harness.emit(CHANNEL, { n: 1 }, { offset: 5, epoch: "e1" });
        const position = opener.publications.at(-1)?.position;
        expect(position).toBeDefined();

        const joiner = recorder();
        harness.client.subscribe(CHANNEL, joiner.handlers);

        expect(joiner.contexts).toEqual([
          {
            channel: CHANNEL,
            origin: "joined",
            // Honest: the joiner attempted no recovery. Keeps every
            // `wasRecovering && !recovered → mark stale` app check correct.
            wasRecovering: false,
            recovered: false,
            position,
          },
        ]);
      });
    });

    describe.skipIf(observable)("no vendor side", () => {
      it("registers consumers and delivers nothing", () => {
        const { client } = create();
        const a = recorder();
        const b = recorder();
        client.subscribe(CHANNEL, a.handlers);
        client.subscribe(CHANNEL, b.handlers);

        expect(a.publications).toHaveLength(0);
        expect(a.contexts).toHaveLength(0);
        expect(b.publications).toHaveLength(0);
        expect(b.contexts).toHaveLength(0);
      });
    });
  });
}
