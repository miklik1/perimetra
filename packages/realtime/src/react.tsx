"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";

import type {
  ConnectionState,
  RealtimeClient,
  RealtimeSubscription,
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
    // `subscribe` THROWS on a duplicate channel (adapter contract). A
    // StrictMode mount→cleanup→mount cycle, or two components briefly mounted
    // on the same channel before cleanup fires, would otherwise let that throw
    // escape the effect and tear down the nearest error boundary. Route it to
    // onError instead, and register cleanup only when subscribe succeeded.
    // Explicitly typed (not inferred) so a future edit that removes the catch's
    // early `return` fails to compile rather than silently calling unsubscribe
    // on an undefined subscription.
    let subscription: RealtimeSubscription;
    try {
      subscription = client.subscribe<T>(
        channel,
        {
          onPublication: (publication) => handlersRef.current.onPublication(publication),
          onSubscribed: (context) => handlersRef.current.onSubscribed?.(context),
          onError: (error) => handlersRef.current.onError?.(error),
        },
        sinceRef.current && { since: sinceRef.current },
      );
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      // Route to the caller's handler; if none is provided, warn so a genuine
      // duplicate (not the benign StrictMode race) isn't silently swallowed.
      if (handlersRef.current.onError) handlersRef.current.onError(normalized);
      else console.warn(`[realtime] subscribe failed for channel "${channel}":`, normalized);
      return;
    }
    return () => subscription.unsubscribe();
  }, [client, channel]);
}
