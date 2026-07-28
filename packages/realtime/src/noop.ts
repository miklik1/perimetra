import { createFanoutRegistry } from "./fanout";
import type { RealtimeClient } from "./types";

/**
 * The default no-op client (ADR 0029): permanently disconnected, delivers
 * nothing, accepts every call. Serves keyless/dev runs and code paths that
 * must not require a realtime backend — the same role the static adapter
 * plays for `@repo/flags` and the no-op `Telemetry` for `@repo/telemetry`.
 *
 * It still routes every subscription through the shared fan-out registry over a
 * null adapter (open returns an inert handle, close does nothing). Exempting it
 * would be a lie by exemption: refcounting and the double-release throw are
 * contract rules, and a no-op that silently tolerates a double release teaches
 * app code — written and tested against the keyless default — a habit the real
 * adapter punishes in production.
 */
export function createNoopRealtime(): RealtimeClient {
  const registry = createFanoutRegistry<object>({
    open: () => ({}),
    close: () => {},
  });
  return {
    connect: () => {},
    disconnect: () => registry.reset(),
    getState: () => "disconnected",
    onStateChange: () => () => {},
    subscribe: registry.subscribe,
    setToken: () => {},
  };
}
