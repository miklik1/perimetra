import { infiniteQueryOptions, keepPreviousData, type QueryKey } from "@tanstack/react-query";

import { appendSearchParams, type SearchParamsInput } from "@repo/utils";

import { type ApiClient } from "../client/create-api-client";
import { mutationOptions, queryOptions } from "../query-helpers";

/**
 * Thin endpoint builders. They EMIT plain `queryOptions`/`mutationOptions`
 * (never custom hooks), so the options-not-hooks contract holds (ADR 0007): the
 * component still owns `useQuery`/`useMutation`. They remove the per-endpoint
 * boilerplate — signal threading, the trust-boundary `parse`, search-param
 * serialization, and per-resource cache tiers — while keeping call sites stable
 * and mirroring the shape a `@hey-api/openapi-ts` generator would emit.
 *
 * Cache invalidation and optimistic updates stay OUT of the builder: they need a
 * `QueryClient`, which only the component has. Pair these with `invalidateKeys`
 * / `optimisticUpdate` spread at the call site (ADR 0007 keeps them composable
 * rather than baked into a hook).
 */

export interface DefineQueryConfig<TData> {
  /** Cache key, from the `keys` factory. */
  queryKey: QueryKey;
  /** Path relative to the client's base URL (e.g. `/users`). */
  path: string;
  /** Trust-boundary validator (e.g. `(d) => userSchema.parse(d)`). Omit to skip. */
  schema?: (data: unknown) => TData;
  /** Serialized onto the URL via `appendSearchParams` (stable, sorted keys). */
  searchParams?: SearchParamsInput;
  /** Per-resource freshness override (see `STALE` tiers). */
  staleTime?: number;
  /** Per-resource gc override (see `GC` tiers). */
  gcTime?: number;
}

export function defineQuery<TData>(client: ApiClient, config: DefineQueryConfig<TData>) {
  const url = appendSearchParams(config.path, config.searchParams);
  return queryOptions({
    queryKey: config.queryKey,
    queryFn: ({ signal }) => client.apiFetch<TData>(url, { signal, parse: config.schema }),
    ...(config.staleTime !== undefined ? { staleTime: config.staleTime } : {}),
    ...(config.gcTime !== undefined ? { gcTime: config.gcTime } : {}),
  });
}

export interface DefineInfiniteQueryConfig<TPage, TPageParam = number> {
  /** Cache key, from the `keys` factory. */
  queryKey: QueryKey;
  /** Path for a given page param (e.g. `(page) => appendSearchParams("/users", { page })`). */
  path: (pageParam: TPageParam) => string;
  /** Trust-boundary validator for one page. Omit to skip. */
  schema?: (data: unknown) => TPage;
  /** First page param. Defaults to `1`. */
  initialPageParam?: TPageParam;
  /**
   * Derive the next page param from the last page. Return `undefined`/`null` to
   * stop — TanStack ONLY stops on those, so a stable non-null cursor (e.g. a
   * constant `0` or `""`) would page forever. Encode "no more" as null/undefined.
   */
  getNextPageParam: (lastPage: TPage) => TPageParam | undefined | null;
  staleTime?: number;
  gcTime?: number;
}

/**
 * Emit `infiniteQueryOptions` for cursor/page pagination — threads the signal +
 * trust-boundary parse like `defineQuery`, and defaults `placeholderData` to
 * `keepPreviousData` so a page fetch doesn't flash empty. Still options-not-hooks
 * (ADR 0007): the component calls `useInfiniteQuery(users.listPaged())`.
 */
export function defineInfiniteQuery<TPage, TPageParam = number>(
  client: ApiClient,
  config: DefineInfiniteQueryConfig<TPage, TPageParam>,
) {
  const initialPageParam = config.initialPageParam ?? (1 as TPageParam);
  return infiniteQueryOptions({
    queryKey: config.queryKey,
    queryFn: ({ pageParam, signal }) =>
      client.apiFetch<TPage>(config.path(pageParam as TPageParam), {
        signal,
        parse: config.schema,
      }),
    initialPageParam,
    getNextPageParam: (lastPage: TPage) => config.getNextPageParam(lastPage) ?? undefined,
    placeholderData: keepPreviousData,
    ...(config.staleTime !== undefined ? { staleTime: config.staleTime } : {}),
    ...(config.gcTime !== undefined ? { gcTime: config.gcTime } : {}),
  });
}

export interface DefineMutationConfig<TData, TVariables> {
  method?: "POST" | "PUT" | "PATCH" | "DELETE";
  /** Static path, or one derived from the variables (e.g. `(id) => /users/${id}`). */
  path: string | ((variables: TVariables) => string);
  /** Request body from the variables. Defaults to the variables themselves. */
  body?: (variables: TVariables) => unknown;
  /** Trust-boundary validator for the response. Omit to skip. */
  schema?: (data: unknown) => TData;
}

export function defineMutation<TData, TVariables>(
  client: ApiClient,
  config: DefineMutationConfig<TData, TVariables>,
) {
  const { method = "POST", path, body, schema } = config;
  return mutationOptions({
    mutationFn: (variables: TVariables) =>
      client.apiFetch<TData>(typeof path === "function" ? path(variables) : path, {
        method,
        body: body ? body(variables) : variables,
        parse: schema,
      }),
  });
}
