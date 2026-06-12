"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";

import { useApiClient } from "@repo/api/react";
import { env } from "@repo/config/env/web";
import { createNoopRealtime, type RealtimeClient } from "@repo/realtime";

import { createWebCentrifugeRealtime } from "../lib/realtime/centrifuge-client";

// Centrifugo websocket endpoint. NEXT_PUBLIC_ so it inlines into the client
// bundle; the local-stack default keeps a fresh clone working with zero env.
const REALTIME_URL = env.NEXT_PUBLIC_REALTIME_URL ?? "ws://localhost:8000/connection/websocket";

const RealtimeContext = createContext<RealtimeClient | null>(null);

/** A `{ token }` response from the realtime token endpoints, defensively read. */
function readToken(data: unknown): string | null {
  if (typeof data === "object" && data !== null && "token" in data) {
    const token = (data as { token: unknown }).token;
    if (typeof token === "string") return token;
  }
  return null;
}

/**
 * App-shell provider for the realtime seam (ADR 0029). Builds ONE Centrifugo
 * client wired against the API's token endpoints through the same-origin
 * proxy — `GET /v1/realtime/token` (connection JWT, auto-refreshed by the SDK
 * on expiry) and `POST /v1/realtime/subscribe-token` (per-channel JWT) — both
 * authenticated by the httpOnly session cookie the `apiFetch` transport
 * already carries. Construction does NOT open a socket: consumers (the
 * projects LIVE badge) call `client.connect()` when they mount, so anonymous
 * routes never pay for a websocket. On the server render the no-op client
 * stands in (permanently "disconnected", accepts every call).
 */
export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const apiClient = useApiClient();
  // Ref'd so the token getters always use the current transport without the
  // client identity churning (a new client would resubscribe everything).
  const apiRef = useRef(apiClient);
  apiRef.current = apiClient;

  const [client] = useState<RealtimeClient>(() => {
    if (typeof window === "undefined") return createNoopRealtime();
    return createWebCentrifugeRealtime({
      url: REALTIME_URL,
      getToken: async () => readToken(await apiRef.current.apiFetch<unknown>("/v1/realtime/token")),
      getSubscriptionToken: async (channel) =>
        readToken(
          await apiRef.current.apiFetch<unknown>("/v1/realtime/subscribe-token", {
            method: "POST",
            body: { channel },
          }),
        ),
    });
  });

  useEffect(() => () => client.disconnect(), [client]);

  return <RealtimeContext.Provider value={client}>{children}</RealtimeContext.Provider>;
}

/** The shared realtime client. Throws outside `<RealtimeProvider>`. */
export function useRealtime(): RealtimeClient {
  const client = useContext(RealtimeContext);
  if (!client) throw new Error("useRealtime must be used within <RealtimeProvider>");
  return client;
}
