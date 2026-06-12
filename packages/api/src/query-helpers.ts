// The options-not-hooks consumption pattern (ADR 0007). The same object feeds
// useQuery / useSuspenseQuery / queryClient.prefetchQuery (RSC hydration).
export { queryOptions, mutationOptions } from "@tanstack/react-query";
