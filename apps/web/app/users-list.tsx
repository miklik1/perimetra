"use client";

import { useQuery, useUsersQueries } from "@repo/api/react";
import { useTranslations } from "@repo/i18n/web";

import { devErrorDetail, errorMessageKey } from "../lib/error-messages";

/**
 * Demo leaf that consumes the same `usersQueries.list()` queryOptions object
 * the RSC parent prefetched. The point: one queryOptions feeds both
 * `queryClient.prefetchQuery` (server) and `useQuery` (client), so the cache
 * key always matches and `useQuery` returns hydrated state with no client
 * refetch on first render.
 *
 * Error states use the error-message catalog (`errorMessageKey` →
 * `useTranslations("errors")`) so the UI shows translated, user-facing copy
 * rather than a raw `error.name`/`error.message` — the same pattern a real app
 * should follow. The underlying detail (e.g. a parse/ZodError) is shown only in
 * development via `devErrorDetail`.
 *
 * NOTE: with the dev mock OFF (e.g. a production build), this demo's `baseUrl`
 * defaults to jsonplaceholder, whose `/users` shape fails `userSchema`, so the
 * query resolves to the mapped "generic" error state below — an intentional
 * exemplar of the error path. The home page itself seeds the happy path from
 * the mock fixtures so `next build` stays clean (see apps/web/app/page.tsx).
 */
export function UsersList() {
  const t = useTranslations("users");
  const tErrors = useTranslations("errors");
  const usersQueries = useUsersQueries();
  const { data, error, status, fetchStatus } = useQuery(usersQueries.list());

  return (
    <section className="border-border w-full max-w-md rounded-md border p-4 text-sm">
      <h2 className="mb-2 font-semibold">{t("rscTitle")}</h2>
      <p className="text-muted-foreground mb-2">
        {t("status", { status })} · {t("fetchStatus", { fetchStatus })}
      </p>
      {data && (
        <ul className="space-y-1">
          {data.map((u) => (
            <li key={u.id}>
              {u.name} — <span className="text-muted-foreground">{u.email}</span>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p className="text-destructive" role="alert">
          {tErrors(errorMessageKey(error))}
          {devErrorDetail(error) && (
            <span className="text-muted-foreground mt-1 block text-xs">
              {devErrorDetail(error)}
            </span>
          )}
        </p>
      )}
    </section>
  );
}
