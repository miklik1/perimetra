"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";

import type {
  ConnectionState,
  RealtimeClient,
  StreamPosition,
  SubscriptionHandlers,
} from "./types";

export * from "./types";
export { createNoopRealtime } from "./noop";

/** The client's connection state as React state (concurrent-safe). */
export function useConnectionState(client: RealtimeClient): ConnectionState {
  return useSyncExternalStore(
    (onStoreChange) => client.onStateChange(onStoreChange),
    () => client.getState(),
    () => client.getState(),
  );
}

export interface UseChannelOptions {
  /**
   * Resume hint, read once per (re)subscribe — changing it does NOT
   * resubscribe (a new `since` mid-subscription has nothing to resume).
   */
  since?: StreamPosition;
}

/**
 * Subscribe to one channel for the lifetime of the component. `channel: null`
 * skips subscribing (the conditional form — e.g. no active job). Handlers are
 * kept in a ref, so inline closures don't churn the subscription; only
 * `client`/`channel` identity changes resubscribe.
 *
 * Several components may sit on the SAME channel — the adapter fans one vendor
 * subscription out to all of them and refcounts the consumers, so a shared
 * broadcast channel (`org:<id>`) is the normal case, not a collision.
 */
export function useChannel<T = unknown>(
  client: RealtimeClient,
  channel: string | null,
  handlers: SubscriptionHandlers<T>,
  options?: UseChannelOptions,
): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const sinceRef = useRef(options?.since);
  sinceRef.current = options?.since;

  useEffect(() => {
    if (channel === null) return;
    // NO try/catch here, deliberately. This effect used to catch the adapter's
    // "already subscribed" throw so a StrictMode mount→cleanup→mount cycle
    // wouldn't tear down the nearest error boundary — but that also swallowed
    // the throw for a SECOND LEGITIMATE consumer of a shared channel, which
    // then silently received nothing. Since the adapters fan out, a duplicate
    // subscribe is no longer an error at all, and everything `subscribe` can
    // still throw (a since-conflict, a double release — see
    // `RealtimeContractError`) is a programming error that MUST reach an error
    // boundary. Catching here would restore the silent-failure class; a test
    // pins that the throw escapes.
    const subscription = client.subscribe<T>(
      channel,
      {
        onPublication: (publication) => handlersRef.current.onPublication(publication),
        onSubscribed: (context) => handlersRef.current.onSubscribed?.(context),
        onError: (error) => handlersRef.current.onError?.(error),
      },
      sinceRef.current && { since: sinceRef.current },
    );
    return () => subscription.unsubscribe();
  }, [client, channel]);
}
