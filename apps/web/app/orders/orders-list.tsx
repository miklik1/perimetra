"use client";

import Link from "next/link";

import { useApiClient, useInfiniteQuery } from "@repo/api/react";
import { useTranslations } from "@repo/i18n/web";
import { Panel } from "@repo/ui";

import { errorMessageKey } from "../../lib/error-messages";
import { createOrdersQueries } from "../../lib/orders-queries";
import { useRole } from "../../lib/use-role";
import { OrderStatusBadge } from "./order-status";

/**
 * Orders list (ADR 0109 / ADR-O1, CAR-156) — the surface that makes "the
 * workshop works from orders, not quotes" real. Infinite keyset pagination
 * (UUIDv7 ids), first page hydrated from the RSC prefetch. Branded like the
 * quotes list: each order is a matte `bg-chrome` panel with its order number in
 * the Amulya data face + a status badge.
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
  const role = useRole();
  const ordersQueries = createOrdersQueries(useApiClient());

  const { data, error, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery(
    ordersQueries.list(),
  );
  const orders = data?.pages.flatMap((page) => page.items) ?? [];
  const hrefFor = (order: { id: string; quoteId: string }) =>
    role === "workshop" ? `/orders/${order.id}/production` : `/quotes/${order.quoteId}`;

  return (
    <section className="flex w-full flex-col gap-3">
      {error && (
        <p className="text-destructive text-sm" role="alert">
          {tErrors(errorMessageKey(error))}
        </p>
      )}
      {orders.length === 0 && !error && (
        <p className="text-muted-foreground rounded-md border border-dashed p-6 text-center">
          {t("empty")}
        </p>
      )}
      <ul className="flex flex-col gap-2">
        {orders.map((order) => (
          <li key={order.id}>
            <Link href={hrefFor(order)} className="block">
              <Panel elevation="flat" padded={false}>
                <div className="flex items-center justify-between gap-4 px-4 py-3">
                  <div className="flex items-center gap-3">
                    <span className="font-data text-sm font-medium">{order.orderNumber}</span>
                    <OrderStatusBadge status={order.status} />
                  </div>
                </div>
              </Panel>
            </Link>
          </li>
        ))}
      </ul>
      {orders.length > 0 && (
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
