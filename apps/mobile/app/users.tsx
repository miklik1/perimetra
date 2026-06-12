import { ScrollView } from "react-native";

import { useQuery, useUsersQueries } from "@repo/api/react";

import { SafeArea, Stack, Text } from "../components/ui";

/**
 * Mobile users screen — the RN mirror of web's `app/users-list.tsx`. Consumes
 * the SAME `usersQueries.list()` queryOptions (one source of truth for the cache
 * key + parse), proving `@repo/api` is platform-agnostic. Web prefetches on the
 * server then hydrates; mobile has no RSC, so `useQuery` fetches on mount and we
 * render the three states (loading / error / data) with RN primitives.
 *
 * NOTE: like web, this points at jsonplaceholder.typicode.com (the default
 * baseUrl). Its `/users` shape (numeric `id`, no `createdAt`) fails `userSchema`,
 * so `apiFetch`'s parse step raises `ApiError({ kind: "parse" })` — the error
 * branch below renders that, exercising the whole fetch → parse pipeline.
 */
export default function Users() {
  const usersQueries = useUsersQueries();
  const { data, error, status, fetchStatus } = useQuery(usersQueries.list());

  return (
    <SafeArea className="bg-background flex-1">
      <ScrollView contentContainerClassName="gap-4 p-6">
        <Text variant="heading">Users</Text>
        <Text variant="caption">
          status: {status} · fetchStatus: {fetchStatus}
        </Text>
        {data && (
          <Stack gap={2}>
            {data.map((u) => (
              <Text key={u.id}>
                {u.name} — <Text variant="caption">{u.email}</Text>
              </Text>
            ))}
          </Stack>
        )}
        {error && (
          <Text variant="caption" className="text-destructive">
            {error.name}: {error.message}
          </Text>
        )}
      </ScrollView>
    </SafeArea>
  );
}
