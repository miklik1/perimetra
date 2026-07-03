"use client";

import Link from "next/link";
import { useDeferredValue, useState } from "react";

import { useApiClient, useInfiniteQuery } from "@repo/api/react";
import { useTranslations } from "@repo/i18n/web";
import { Panel } from "@repo/ui";

import { createCustomersQueries } from "../../lib/customers-queries";
import { errorMessageKey } from "../../lib/error-messages";

const searchInputClass =
  "border-border bg-background focus-visible:ring-ring rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-2 w-full max-w-sm";

/**
 * Per-rep customers list (ADR 0082/CAR-23) — infinite keyset pagination (first
 * page hydrated from the RSC prefetch), filtered by a name/IČO search box. The
 * search term is deferred (`useDeferredValue`, no extra dependency) so typing
 * doesn't fire a fresh query per keystroke; each distinct committed term is its
 * own cache entry (`customerKeys.list` includes it), same shape as `status`.
 */
export function CustomersList() {
  const t = useTranslations("customers");
  const tErrors = useTranslations("errors");
  const customersQueries = createCustomersQueries(useApiClient());
  const [searchInput, setSearchInput] = useState("");
  const search = useDeferredValue(searchInput.trim()) || undefined;

  const { data, error, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery(
    customersQueries.list({ search }),
  );
  const customers = data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <section className="flex w-full flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm font-medium">
        {t("searchLabel")}
        <input
          type="search"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder={t("searchPlaceholder")}
          className={searchInputClass}
        />
      </label>

      {error && (
        <p className="text-destructive text-sm" role="alert">
          {tErrors(errorMessageKey(error))}
        </p>
      )}
      {customers.length === 0 && !error && (
        <p className="text-muted-foreground rounded-md border border-dashed p-6 text-center">
          {search ? t("noResults") : t("empty")}
        </p>
      )}
      <ul className="flex flex-col gap-2">
        {customers.map((customer) => (
          <li key={customer.id}>
            <Link href={`/customers/${customer.id}`} className="block">
              <Panel elevation="flat" padded={false}>
                <div className="flex items-center justify-between gap-4 px-4 py-3">
                  <div className="min-w-0">
                    <span className={customer.status === "archived" ? "text-muted-foreground" : ""}>
                      {customer.name}
                    </span>
                    {customer.ico && (
                      <span className="text-muted-foreground block text-xs">{customer.ico}</span>
                    )}
                  </div>
                  {customer.status === "archived" && (
                    <span className="text-muted-foreground text-xs">{t("status.archived")}</span>
                  )}
                </div>
              </Panel>
            </Link>
          </li>
        ))}
      </ul>
      {customers.length > 0 && (
        <button
          type="button"
          onClick={() => void fetchNextPage()}
          disabled={!hasNextPage || isFetchingNextPage}
          className="border-border self-start rounded-md border px-3 py-1 text-sm disabled:opacity-50"
        >
          {isFetchingNextPage ? t("loading") : hasNextPage ? t("loadMore") : t("noMore")}
        </button>
      )}
    </section>
  );
}
