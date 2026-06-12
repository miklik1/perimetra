import { type QueryClient, type QueryKey } from "@tanstack/react-query";

export interface OptimisticConfig<TData, TVariables> {
  /** The QueryClient holding the cache to patch (from `useQueryClient()`). */
  queryClient: QueryClient;
  /** The query key whose cached data is optimistically updated. */
  key: QueryKey;
  /** Produce the next cached value from the current one + the mutation input. */
  update: (current: TData | undefined, variables: TVariables) => TData;
}

/** Snapshot carried from `onMutate` to `onError` for rollback. */
export interface OptimisticContext<TData> {
  previous: TData | undefined;
}

/**
 * The three mutation lifecycle handlers implementing optimistic-update-with-
 * rollback. Stays options-not-hooks (ADR 0007): the result is spread into
 * `mutationOptions`/`useMutation`, so the component still owns the hook.
 *
 * ```ts
 * useMutation({
 *   ...users.update(id),
 *   ...optimisticUpdate<User, UpdateUserInput>({
 *     queryClient,
 *     key: keys.users.detail(id),
 *     update: (current, input) => ({ ...current!, ...input }),
 *   }),
 * });
 * ```
 *
 * `onMutate` cancels in-flight queries, snapshots the current value, and applies
 * the update; `onError` restores the snapshot; `onSettled` revalidates against
 * the server. Compose with `invalidateKeys` in `onSuccess` to refresh related
 * lists.
 */
export function optimisticUpdate<TData, TVariables>(config: OptimisticConfig<TData, TVariables>) {
  const { queryClient, key, update } = config;
  return {
    onMutate: async (variables: TVariables): Promise<OptimisticContext<TData>> => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<TData>(key);
      queryClient.setQueryData<TData>(key, (current) => update(current, variables));
      return { previous };
    },
    onError: (
      _error: unknown,
      _variables: TVariables,
      context: OptimisticContext<TData> | undefined,
    ) => {
      if (context) queryClient.setQueryData(key, context.previous);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: key });
    },
  };
}
