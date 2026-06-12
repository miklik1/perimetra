"use client";

import { useInfiniteQuery, useUsersQueries } from "@repo/api/react";
import { useFlag } from "@repo/flags/web";
import { useTranslations } from "@repo/i18n/web";

import { devErrorDetail, errorMessageKey } from "../lib/error-messages";

/**
 * Demo leaf for cursor pagination (ADR 0018): `useInfiniteQuery` over
 * `users.listPaged()`, which the `defineInfiniteQuery` builder emits with
 * `getNextPageParam` (reads each page's `nextPage`) and `keepPreviousData`. With
 * the `users` mock on it pages through the synthetic set; "Load more" is gated by
 * `hasNextPage`. All copy is translated (ADR 0020) and errors flow through the
 * error-message catalog like the other exemplars.
 *
 * The whole widget is gated by the `example-flag` feature flag (ADR 0028),
 * evaluated CLIENT-side via `useFlag` from the no-flash bootstrap the RSC layout
 * threads in. Doing the cosmetic gate here (not with the async server `getFlag`
 * in page.tsx) keeps the home route statically renderable — a feature flag
 * should not silently opt a public page into per-request dynamic rendering.
 */
export function UsersInfiniteList() {
  const enabled = useFlag("example-flag");
  const t = useTranslations("users");
  const tErrors = useTranslations("errors");
  const usersQueries = useUsersQueries();
  const { data, error, status, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery(
    usersQueries.listPaged(10),
  );

  const users = data?.pages.flatMap((page) => page.data) ?? [];

  // Flag OFF (or no PostHog key + registry default false) ⇒ render nothing. The
  // gate runs after the hooks so the Rules of Hooks hold.
  if (!enabled) return null;

  return (
    <section className="border-border w-full max-w-md rounded-md border p-4 text-sm">
      <h2 className="mb-2 font-semibold">{t("infiniteTitle")}</h2>
      <p className="text-muted-foreground mb-2">
        {t("status", { status })} · {t("loaded", { count: users.length })}
      </p>
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
      <ul className="mb-3 space-y-1">
        {users.map((u) => (
          <li key={u.id}>
            {u.name} — <span className="text-muted-foreground">{u.email}</span>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() => void fetchNextPage()}
        disabled={!hasNextPage || isFetchingNextPage}
        className="border-border rounded-md border px-3 py-1 disabled:opacity-50"
      >
        {isFetchingNextPage ? t("loading") : hasNextPage ? t("loadMore") : t("noMore")}
      </button>
    </section>
  );
}
