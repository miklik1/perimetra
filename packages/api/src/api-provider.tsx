"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, useContext, useState, type ReactNode } from "react";

import { createApiClient, type ApiClient, type ApiClientConfig } from "./client/create-api-client";
import { makeQueryClient } from "./client/query-client";

const ApiClientContext = createContext<ApiClient | null>(null);

export interface ApiProviderProps extends ApiClientConfig {
  children: ReactNode;
  /**
   * Optional pre-built QueryClient, read once at mount (a `useState`
   * initializer). Later changes are ignored. Defaults to a fresh
   * `makeQueryClient()`. Pass one to seed the cache (tests) or share an
   * externally-owned client.
   */
  initialQueryClient?: QueryClient;
}

/**
 * Single entry point for the data layer on both apps: builds the transport
 * (`createApiClient`) and the QueryClient once, and provides both. `useState`
 * initializers run once per mount — no module-global state and no
 * configure-before-use ordering hazard. The browser and RN each build their own
 * client here; the RSC server builds its own for prefetch (see
 * `apps/web/lib/server-api.ts`).
 */
export function ApiProvider({ children, initialQueryClient, ...config }: ApiProviderProps) {
  const [client] = useState(() => createApiClient(config));
  const [queryClient] = useState(() => initialQueryClient ?? makeQueryClient());

  return (
    <ApiClientContext.Provider value={client}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </ApiClientContext.Provider>
  );
}

/** Read the configured `ApiClient`. Throws if used outside `<ApiProvider>`. */
export function useApiClient(): ApiClient {
  const client = useContext(ApiClientContext);
  if (!client) throw new Error("useApiClient must be used within <ApiProvider>");
  return client;
}
