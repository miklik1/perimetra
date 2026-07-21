"use client";

import Link from "next/link";

import { useApiClient, useInfiniteQuery } from "@repo/api/react";
import { useLocale, useTranslations } from "@repo/i18n/web";
import { Button, EmptyState, Icon, Skeleton } from "@repo/ui";
import { formatDate } from "@repo/utils";

import { errorMessageKey } from "../../lib/error-messages";
import { createOrdersQueries } from "../../lib/orders-queries";
import { useRole } from "../../lib/use-role";
import { OrderStatusBadge } from "./order-status";

/**
 * Orders list (ADR 0109 / ADR-O1, CAR-156) — the surface that makes "the
 * workshop works from orders, not quotes" real. Infinite keyset pagination
 * (UUIDv7 ids), first page hydrated from the RSC prefetch.
 *
 * Reskinned to the canvas o-LIST look (design/configurator/frames-order.jsx
 * `FrameList`): a bare, accessible `<table>` — uppercase muted column heads,
 * hairline-divided rows, per-row hover — rather than a Panel-per-row list. Only
 * the three fields `orderSchema` actually carries are shown (orderNumber /
 * status / createdAt); the canvas's name/product/id/due/value columns and its
 * KPI tile row are OMITTED — the api has no customer/product/value/due data and
 * no aggregate endpoint, so a keyset page can't honestly supply a total or a
 * count (contract-honesty deviation, recorded in the surface's ship report).
 * Each row is ONE focusable stretched-link anchor (the order number cell) —
 * full-row click/tap + a single tab stop per row.
 *
 * Per-row routing mirrors the quotes list's role split, but order-scoped: a
 * `workshop` role goes to the price-blind `/orders/:id/production` build view
 * (its primary surface), while `admin`/`sales` open the order's commercial
 * truth — the underlying priced quote (`/quotes/:quoteId`). Every status shows;
 * `confirmed`/`in_production` are the actively-workable ones (the badge tells
 * them apart) — a workable-only server filter is a documented follow-on (the
 * single-status api filter can't express the two-status set, and client-side
 * filtering would break keyset pagination).
 */
export function OrdersList() {
  const t = useTranslations("orders");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const role = useRole();
  const ordersQueries = createOrdersQueries(useApiClient());

  const { data, error, isPending, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useInfiniteQuery(ordersQueries.list());
  const orders = data?.pages.flatMap((page) => page.items) ?? [];
  const hrefFor = (order: { id: string; quoteId: string }) =>
    role === "workshop" ? `/orders/${order.id}/production` : `/quotes/${order.quoteId}`;

  return (
    <section className="flex w-full flex-col gap-4">
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
      {!isPending && orders.length === 0 && !error && (
        <EmptyState>
          <EmptyState.Icon>
            <Icon name="list" />
          </EmptyState.Icon>
          <EmptyState.Title>{t("empty")}</EmptyState.Title>
          <EmptyState.Description>{t("emptyDescription")}</EmptyState.Description>
        </EmptyState>
      )}
      {orders.length > 0 && (
        <div className="overflow-x-auto">
          <table aria-label={t("tableLabel")} className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th
                  scope="col"
                  className="text-muted-foreground pb-2 text-left text-xs font-medium uppercase tracking-wide"
                >
                  {t("columns.orderNumber")}
                </th>
                <th
                  scope="col"
                  className="text-muted-foreground pb-2 text-left text-xs font-medium uppercase tracking-wide"
                >
                  {t("columns.status")}
                </th>
                <th
                  scope="col"
                  className="text-muted-foreground pb-2 text-right text-xs font-medium uppercase tracking-wide"
                >
                  {t("columns.createdAt")}
                </th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id} className="border-border hover:bg-chrome relative border-t">
                  <td className="py-3">
                    <Link
                      href={hrefFor(order)}
                      className="font-data focus-visible:ring-ring rounded font-medium outline-none after:absolute after:inset-0 focus-visible:ring-2"
                    >
                      {order.orderNumber}
                    </Link>
                  </td>
                  <td className="py-3">
                    <OrderStatusBadge status={order.status} />
                  </td>
                  <td className="py-3 text-right">
                    <span className="font-data text-muted-foreground tabular-nums">
                      {formatDate(order.createdAt, { dateStyle: "medium" }, locale)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {orders.length > 0 && (
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
