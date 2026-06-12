import { Centrifuge } from "centrifuge";
import type {
  SubscribedContext as CentrifugeSubscribedContext,
  PublicationContext,
  Subscription,
} from "centrifuge";

import type {
  ConnectionState,
  RealtimeClient,
  RealtimeSubscription,
  StreamPosition,
  SubscribeOptions,
  SubscriptionHandlers,
} from "@repo/realtime";
import { createLogger } from "@repo/utils";

const logger = createLogger({ scope: "realtime" });

/**
 * App-side Centrifugo adapter implementing the vendor-neutral `RealtimeClient`
 * contract (ADR 0029). A near-copy of `@repo/realtime/centrifuge` with ONE
 * addition the package adapter doesn't model yet: a per-channel
 * `getSubscriptionToken` (the SDK's subscription-level `getToken`), required
 * because the local Centrifugo namespaces (`user`, `org`) don't allow
 * client-side subscribe without a subscription JWT — the API mints them at
 * `POST /v1/realtime/subscribe-token`. Components stay on the neutral
 * interface (`useChannel`/`useConnectionState` from `@repo/realtime/react`);
 * only this composition-root file touches the SDK. Upstream candidate:
 * fold `getSubscriptionToken` into `CentrifugeRealtimeConfig`/`SubscribeOptions`
 * and delete this file.
 */
export interface WebCentrifugeConfig {
  /** WebSocket endpoint, e.g. `ws://localhost:8000/connection/websocket`. */
  url: string;
  /** Connection JWT source — `GET /v1/realtime/token`. Called on connect and expiry. */
  getToken: () => Promise<string | null>;
  /** Subscription JWT source — `POST /v1/realtime/subscribe-token` per channel. */
  getSubscriptionToken: (channel: string) => Promise<string | null>;
  debug?: boolean;
}

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

export function createWebCentrifugeRealtime(config: WebCentrifugeConfig): RealtimeClient {
  const client = new Centrifuge(config.url, {
    debug: config.debug ?? false,
    getToken: async () => (await config.getToken()) ?? "",
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
      // The per-channel token (the one addition over @repo/realtime/centrifuge):
      // fetched on subscribe AND on token expiry — the SDK's refresh hook.
      getToken: async () => (await config.getSubscriptionToken(channel)) ?? "",
      ...(options?.since &&
        options.since.offset > 0 && {
          since: { offset: options.since.offset, epoch: options.since.epoch },
        }),
    });

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
