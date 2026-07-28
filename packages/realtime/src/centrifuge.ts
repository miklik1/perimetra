import { Centrifuge } from "centrifuge";
import type {
  SubscribedContext as CentrifugeSubscribedContext,
  PublicationContext,
  Subscription,
} from "centrifuge";

import { createLogger } from "@repo/utils";

import { createFanoutRegistry } from "./fanout";
import type { ConnectionState, RealtimeClient, StreamPosition } from "./types";

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
  /**
   * Per-channel subscription-token source (the SDK's subscription-level
   * `getToken`), for namespaces that require a subscription JWT — Centrifugo
   * refuses a client-side subscribe to a protected namespace without one. Called
   * on subscribe AND on subscription-token expiry. Omit for open namespaces.
   *
   * Fan-out keeps this correct for free: there is still exactly ONE vendor
   * subscription per channel however many consumers are attached, so the token
   * is minted once per channel, not once per consumer.
   */
  getSubscriptionToken?: (channel: string) => string | null | Promise<string | null>;
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
 * client on web and RN). Transport only: connection lifecycle, one VENDOR
 * subscription per channel, stream-position bookkeeping for history recovery.
 * The SDK already queues subscriptions made while disconnected and replays
 * them on (re)connect, which satisfies the contract's any-state `subscribe`.
 *
 * Consumer bookkeeping — several readers of one broadcast channel, refcounting,
 * deferred teardown — belongs to the shared fan-out registry, not here. This
 * file owns only `open` (build the SDK subscription, wire its three events into
 * the sink) and `close` (full teardown).
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

  const registry = createFanoutRegistry<Subscription>({
    open(channel, since, sink) {
      const subscription = client.newSubscription(channel, {
        ...(config.getSubscriptionToken && {
          getToken: async () => (await config.getSubscriptionToken!(channel)) ?? "",
        }),
        ...(since &&
          since.offset > 0 && {
            since: { offset: since.offset, epoch: since.epoch },
          }),
      });

      // Publications carry only the offset; the epoch arrives once per
      // (re)subscribe. Track the latest so `position` is always composable.
      // Lives in this closure (one per vendor subscription), so it survives
      // every consumer joining and leaving and is lost only on a real close.
      let epoch = since?.epoch ?? "";

      subscription.on("subscribed", (ctx: CentrifugeSubscribedContext) => {
        if (ctx.streamPosition) epoch = ctx.streamPosition.epoch;
        const position: StreamPosition | undefined = ctx.streamPosition
          ? { offset: ctx.streamPosition.offset, epoch: ctx.streamPosition.epoch }
          : undefined;
        sink.subscribed({
          wasRecovering: ctx.wasRecovering,
          recovered: ctx.recovered,
          position,
        });
      });

      subscription.on("publication", (ctx: PublicationContext) => {
        const position: StreamPosition | undefined =
          ctx.offset !== undefined ? { offset: ctx.offset, epoch } : undefined;
        sink.publication({ data: ctx.data, position });
      });

      subscription.on("error", (ctx) => {
        logger.error(`subscription error on "${channel}"`, ctx);
        sink.error(new Error(ctx.error.message));
      });

      subscription.subscribe();
      return subscription;
    },
    close(_channel, subscription) {
      subscription.unsubscribe();
      subscription.removeAllListeners();
      client.removeSubscription(subscription);
    },
  });

  return {
    connect: () => client.connect(),
    disconnect() {
      registry.reset();
      client.disconnect();
    },
    getState: () => toConnectionState(client.state),
    onStateChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    subscribe: registry.subscribe,
    setToken: (token) => client.setToken(token ?? ""),
  };
}
