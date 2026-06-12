import { Centrifuge } from "centrifuge";
import type {
  SubscribedContext as CentrifugeSubscribedContext,
  PublicationContext,
  Subscription,
} from "centrifuge";

import { createLogger } from "@repo/utils";

import type {
  ConnectionState,
  RealtimeClient,
  RealtimeSubscription,
  StreamPosition,
  SubscribeOptions,
  SubscriptionHandlers,
} from "./types";

const logger = createLogger({ scope: "realtime" });

export interface CentrifugeRealtimeConfig {
  /** WebSocket endpoint, e.g. `wss://rt.example.com/connection/websocket`. From env, app-side. */
  url: string;
  /**
   * Connection-token source, called on connect and on token expiry (the SDK's
   * refresh hook). Injected by the app — typically `@repo/auth`'s token
   * manager — so no `realtime → auth` edge exists. `null` connects anonymous.
   */
  getToken?: () => string | null | Promise<string | null>;
  /** Hard cap on a single connect attempt. SDK default when omitted. */
  timeoutMs?: number;
  /** Reconnect backoff window. SDK defaults when omitted. */
  minReconnectDelayMs?: number;
  maxReconnectDelayMs?: number;
  debug?: boolean;
}

/** Map the SDK's connection state strings onto the contract's. */
function toConnectionState(state: Centrifuge["state"]): ConnectionState {
  switch (state) {
    case "connected":
      return "connected";
    case "connecting":
      return "connecting";
    default:
      return "disconnected";
  }
}

/**
 * The Centrifugo adapter (ADR 0029) over the `centrifuge` SDK (pure JS — same
 * client on web and RN). Transport only: connection lifecycle, one
 * subscription per channel, stream-position bookkeeping for history recovery.
 * The SDK already queues subscriptions made while disconnected and replays
 * them on (re)connect, which satisfies the contract's any-state `subscribe`.
 */
export function createCentrifugeRealtime(config: CentrifugeRealtimeConfig): RealtimeClient {
  const client = new Centrifuge(config.url, {
    debug: config.debug ?? false,
    ...(config.timeoutMs !== undefined && { timeout: config.timeoutMs }),
    ...(config.minReconnectDelayMs !== undefined && {
      minReconnectDelay: config.minReconnectDelayMs,
    }),
    ...(config.maxReconnectDelayMs !== undefined && {
      maxReconnectDelay: config.maxReconnectDelayMs,
    }),
    // The SDK calls this on connect AND when the server signals token expiry,
    // so rotation is automatic; an empty string connects anonymous.
    ...(config.getToken && {
      getToken: async () => (await config.getToken!()) ?? "",
    }),
  });

  const listeners = new Set<(state: ConnectionState) => void>();
  const notify = () => {
    const state = toConnectionState(client.state);
    listeners.forEach((listener) => listener(state));
  };
  client.on("connecting", notify);
  client.on("connected", notify);
  client.on("disconnected", notify);
  client.on("error", (ctx) => logger.error("connection error", ctx));

  const subscriptions = new Map<string, Subscription>();

  function subscribe<T>(
    channel: string,
    handlers: SubscriptionHandlers<T>,
    options?: SubscribeOptions,
  ): RealtimeSubscription {
    if (subscriptions.has(channel)) {
      throw new Error(`Already subscribed to channel "${channel}"`);
    }

    const subscription = client.newSubscription(channel, {
      ...(options?.since &&
        options.since.offset > 0 && {
          since: { offset: options.since.offset, epoch: options.since.epoch },
        }),
    });

    // Publications carry only the offset; the epoch arrives once per
    // (re)subscribe. Track the latest so `position` is always composable.
    let epoch = options?.since?.epoch ?? "";

    subscription.on("subscribed", (ctx: CentrifugeSubscribedContext) => {
      if (ctx.streamPosition) epoch = ctx.streamPosition.epoch;
      const position: StreamPosition | undefined = ctx.streamPosition
        ? { offset: ctx.streamPosition.offset, epoch: ctx.streamPosition.epoch }
        : undefined;
      handlers.onSubscribed?.({
        channel,
        wasRecovering: ctx.wasRecovering,
        recovered: ctx.recovered,
        position,
      });
    });

    subscription.on("publication", (ctx: PublicationContext) => {
      const position: StreamPosition | undefined =
        ctx.offset !== undefined ? { offset: ctx.offset, epoch } : undefined;
      handlers.onPublication({ data: ctx.data as T, position });
    });

    subscription.on("error", (ctx) => {
      logger.error(`subscription error on "${channel}"`, ctx);
      handlers.onError?.(new Error(ctx.error.message));
    });

    subscription.subscribe();
    subscriptions.set(channel, subscription);

    return {
      channel,
      unsubscribe: () => unsubscribe(channel),
    };
  }

  function unsubscribe(channel: string): void {
    const subscription = subscriptions.get(channel);
    if (!subscription) return;
    subscriptions.delete(channel);
    subscription.unsubscribe();
    subscription.removeAllListeners();
    client.removeSubscription(subscription);
  }

  return {
    connect: () => client.connect(),
    disconnect() {
      for (const channel of Array.from(subscriptions.keys())) unsubscribe(channel);
      client.disconnect();
    },
    getState: () => toConnectionState(client.state),
    onStateChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    subscribe,
    setToken: (token) => client.setToken(token ?? ""),
  };
}
