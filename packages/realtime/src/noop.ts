import type { RealtimeClient, RealtimeSubscription } from "./types";

/**
 * The default no-op client (ADR 0029): permanently disconnected, delivers
 * nothing, accepts every call. Serves keyless/dev runs and code paths that
 * must not require a realtime backend — the same role the static adapter
 * plays for `@repo/flags` and the no-op `Telemetry` for `@repo/telemetry`.
 */
export function createNoopRealtime(): RealtimeClient {
  const subscription = (channel: string): RealtimeSubscription => ({
    channel,
    unsubscribe: () => {},
  });
  return {
    connect: () => {},
    disconnect: () => {},
    getState: () => "disconnected",
    onStateChange: () => () => {},
    subscribe: (channel) => subscription(channel),
    setToken: () => {},
  };
}
