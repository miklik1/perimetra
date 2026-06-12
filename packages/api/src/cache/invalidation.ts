import { type QueryClient, type QueryKey } from "@tanstack/react-query";

/**
 * Invalidate a set of query keys in one call. Each key invalidates everything
 * beneath its prefix (the key factory nests — see `keys.ts`), so passing
 * `keys.users.lists()` refreshes every list variant. Key-scoped and type-safe:
 * callers pass keys from the factory, never raw strings.
 *
 * Spread the result into a mutation's `onSuccess`, or call directly:
 *
 * ```ts
 * useMutation({
 *   ...users.create(),
 *   onSuccess: () => invalidateKeys(queryClient, [keys.users.lists()]),
 * });
 * ```
 */
export async function invalidateKeys(
  queryClient: QueryClient,
  queryKeys: QueryKey[],
): Promise<void> {
  await Promise.all(queryKeys.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
}
