import { stableParams, type SearchParamsInput } from "@repo/utils";

/**
 * Hierarchical, const-asserted query-key factory. Prefixes nest so a parent
 * key invalidates everything beneath it, e.g.
 * `queryClient.invalidateQueries({ queryKey: keys.users.all })` clears every
 * users query, while `keys.users.detail(id)` targets one. List filters pass
 * through `stableParams` so equivalent queries share a cache entry regardless
 * of property order.
 */
export const keys = {
  users: {
    all: ["users"] as const,
    lists: () => [...keys.users.all, "list"] as const,
    list: (filters?: SearchParamsInput) => [...keys.users.lists(), stableParams(filters)] as const,
    pages: (filters?: SearchParamsInput) =>
      [...keys.users.all, "pages", stableParams(filters)] as const,
    details: () => [...keys.users.all, "detail"] as const,
    detail: (id: string) => [...keys.users.details(), id] as const,
  },
  auth: {
    all: ["auth"] as const,
    me: () => [...keys.auth.all, "me"] as const,
  },
  // @gen:exports — `pnpm gen api-resource` adds the resource key tier here.
} as const;
