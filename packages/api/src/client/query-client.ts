import { isServer, MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { cache } from "react";

import { DEFAULT_RETRY, GC, STALE_TIME_MS } from "@repo/config/constants";

export interface MakeQueryClientOptions {
  /**
   * Fires for every error that SURFACES from a query or mutation (after
   * retries are exhausted). The DI seam for observability (ADR 0021): the app
   * supplies a handler that forwards to telemetry — `@repo/api` itself stays
   * telemetry-agnostic, so this package never imports an error tracker.
   */
  onError?: (error: unknown) => void;
}

/**
 * Pure factory — the single home for the shared query defaults. `staleTime` and
 * `gcTime` are the global baseline (`STALE.FRESH` / `GC.MEDIUM`); per-resource
 * endpoints override `staleTime`/`gcTime` through the builder when their
 * volatility differs (see `@repo/config` `STALE`/`GC` tiers).
 */
export function makeQueryClient(options: MakeQueryClientOptions = {}): QueryClient {
  const { onError } = options;
  return new QueryClient({
    ...(onError
      ? {
          queryCache: new QueryCache({ onError: (error) => onError(error) }),
          mutationCache: new MutationCache({ onError: (error) => onError(error) }),
        }
      : {}),
    defaultOptions: {
      queries: {
        staleTime: STALE_TIME_MS,
        gcTime: GC.MEDIUM,
        retry: DEFAULT_RETRY,
      },
    },
  });
}

// One client per request on the server (React `cache` memoizes within a request).
const getServerQueryClient = cache(() => makeQueryClient());

let browserQueryClient: QueryClient | undefined;

/**
 * Returns the QueryClient for the current environment: request-scoped on the
 * Next.js server (via React `cache`), singleton in the browser.
 *
 * NOTE: React Native must NOT use this — `apps/mobile` keeps
 * `useState(makeQueryClient)` + `QueryClientProvider`, sidestepping the Hermes
 * server/browser ambiguity.
 */
export function getQueryClient(): QueryClient {
  if (isServer) return getServerQueryClient();
  if (!browserQueryClient) browserQueryClient = makeQueryClient();
  return browserQueryClient;
}
