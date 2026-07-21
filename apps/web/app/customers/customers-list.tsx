"use client";

import Link from "next/link";
import { useDeferredValue, useState } from "react";

import { useApiClient, useInfiniteQuery } from "@repo/api/react";
import { useTranslations } from "@repo/i18n/web";
import { Badge, Button, EmptyState, Icon, Input, Skeleton } from "@repo/ui";

import { createCustomersQueries } from "../../lib/customers-queries";
import { errorMessageKey } from "../../lib/error-messages";

/**
 * Per-rep customers list (ADR 0082/CAR-23), reskinned to the shipped o-LIST
 * table language (ADR 0119/0120, design/README.md §6/§11.1) for internal-list
 * consistency — a bare, accessible `<table>` (uppercase muted column heads,
 * hairline-divided rows, per-row hover) in place of the Panel-per-row list.
 * Infinite keyset pagination (first page hydrated from the RSC prefetch),
 * filtered by a name/IČO search box.
 *
 * The search term is deferred (`useDeferredValue`, no extra dependency) so
 * typing doesn't fire a fresh query per keystroke; each distinct committed
 * term is its own cache entry (`customerKeys.list` includes it), same shape
 * as `status`.
 *
 * PURE-NAV: the whole row is one stretched-link `<Link>` to `/customers/:id`
 * — archive/restore live on the detail, NOT here.
 */
export function CustomersList() {
  const t = useTranslations("customers");
  const tErrors = useTranslations("errors");
  const customersQueries = createCustomersQueries(useApiClient());
  const [searchInput, setSearchInput] = useState("");
  const search = useDeferredValue(searchInput.trim()) || undefined;

  const { data, error, isPending, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useInfiniteQuery(customersQueries.list({ search }));
  const customers = data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <section className="flex w-full flex-col gap-4">
      <label className="flex max-w-sm flex-col gap-1 text-sm font-medium">
        {t("searchLabel")}
        <Input
          type="search"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder={t("searchPlaceholder")}
        />
      </label>

      {error && (
        <p className="text-destructive text-sm" role="alert">
          {tErrors(errorMessageKey(error))}
        </p>
      )}
      {isPending && !error && (
        <div className="flex flex-col gap-2" aria-hidden>
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      )}
      {!isPending && customers.length === 0 && !error && (
        <EmptyState>
          <EmptyState.Icon>
            <Icon name="list" />
          </EmptyState.Icon>
          <EmptyState.Title>{search ? t("noResults") : t("empty")}</EmptyState.Title>
        </EmptyState>
      )}
      {customers.length > 0 && (
        <div className="relative min-w-0 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th
                  scope="col"
                  className="text-muted-foreground pb-2 text-left text-xs font-medium uppercase tracking-wide"
                >
                  {t("columns.name")}
                </th>
                <th
                  scope="col"
                  className="text-muted-foreground pb-2 text-left text-xs font-medium uppercase tracking-wide"
                >
                  {t("columns.ico")}
                </th>
                <th
                  scope="col"
                  className="text-muted-foreground pb-2 text-left text-xs font-medium uppercase tracking-wide"
                >
                  {t("columns.city")}
                </th>
                <th
                  scope="col"
                  className="text-muted-foreground pb-2 text-left text-xs font-medium uppercase tracking-wide"
                >
                  {t("columns.status")}
                </th>
              </tr>
            </thead>
            <tbody>
              {customers.map((customer) => (
                <tr key={customer.id} className="border-border hover:bg-chrome relative border-t">
                  <td className="py-3">
                    <Link
                      href={`/customers/${customer.id}`}
                      className={`font-data focus-visible:ring-ring rounded font-medium outline-none after:absolute after:inset-0 focus-visible:ring-2 ${
                        customer.status === "archived" ? "text-muted-foreground" : ""
                      }`}
                    >
                      {customer.name}
                    </Link>
                  </td>
                  <td className="py-3">
                    <span className="font-data text-muted-foreground">{customer.ico || "—"}</span>
                  </td>
                  <td className="py-3">
                    <span className="text-muted-foreground">{customer.city || "—"}</span>
                  </td>
                  <td className="py-3">
                    <Badge tone={customer.status === "archived" ? "outline" : "success"}>
                      {t(`status.${customer.status}`)}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {customers.length > 0 && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void fetchNextPage()}
          disabled={!hasNextPage || isFetchingNextPage}
          className="self-start"
        >
          {isFetchingNextPage ? t("loading") : hasNextPage ? t("loadMore") : t("noMore")}
        </Button>
      )}
    </section>
  );
}
