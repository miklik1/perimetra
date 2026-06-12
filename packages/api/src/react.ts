"use client";

import { useApiClient } from "./api-provider";
import { createAuthQueries } from "./endpoints/auth";
import { createUsersQueries } from "./endpoints/users";

// Client-only surface (`@repo/api/react`): the provider, the client hook,
// per-endpoint hooks, and the TanStack hooks the apps call from "use client"
// components. RSC-safe utilities (`dehydrate`, `HydrationBoundary`) are NOT here
// — they live on the server-safe barrel `@repo/api` (`./index`).
export { ApiProvider, useApiClient } from "./api-provider";
export type { ApiProviderProps } from "./api-provider";

export {
  useQuery,
  useSuspenseQuery,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";

/**
 * Per-endpoint hook: binds the endpoint factory to the client from context, so
 * components consume `useUsersQueries().list()` without threading the client.
 */
export const useUsersQueries = () => createUsersQueries(useApiClient());

/** Per-endpoint hook for auth (`login`, `me`), bound to the client from context. */
export const useAuthQueries = () => createAuthQueries(useApiClient());
