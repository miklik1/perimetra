import { defineInfiniteQuery, defineQuery } from "@repo/api";
import type { ApiClient } from "@repo/api";
import { appendSearchParams, stableParams, type SearchParamsInput } from "@repo/utils";
import {
  orderSchema,
  ordersPageSchema,
  quoteProductionSchema,
  type OrderDetail,
  type OrdersPage,
  type OrderStatus,
  type QuoteProduction,
} from "@repo/validators";

/**
 * Orders endpoint factory + key tier (ADR 0007 pattern, mirrors
 * `createQuotesQueries`): the keyset list + the re-homed price-blind production
 * view (ADR 0109 / ADR-O1). An order carries no money of its own — its
 * production projection IS its quote's, resolved through the frozen snapshot, so
 * the `production` query returns the identical `QuoteProduction` shape the
 * quote-keyed read did. App-side consumption layer; transport rides the
 * same-origin proxy (mock group `orders`, or the real `/v1/orders`).
 */
const orderKeys = {
  all: ["orders"] as const,
  lists: () => [...orderKeys.all, "list"] as const,
  list: (filters?: SearchParamsInput) => [...orderKeys.lists(), stableParams(filters)] as const,
  details: () => [...orderKeys.all, "detail"] as const,
  detail: (id: string) => [...orderKeys.details(), id] as const,
  productions: () => [...orderKeys.all, "production"] as const,
  production: (id: string) => [...orderKeys.productions(), id] as const,
} as const;

export type ListOrdersFilters = {
  limit?: number;
  sort?: "createdAt:asc" | "createdAt:desc";
  status?: OrderStatus;
};

export function createOrdersQueries(client: ApiClient) {
  return {
    list: (filters?: ListOrdersFilters) =>
      defineInfiniteQuery<OrdersPage, string>(client, {
        queryKey: orderKeys.list(filters),
        initialPageParam: "",
        path: (cursor) =>
          appendSearchParams("/v1/orders", { ...filters, cursor: cursor || undefined }),
        schema: (data) => ordersPageSchema.parse(data),
        getNextPageParam: (lastPage) => lastPage.nextCursor,
      }),

    // GET /v1/orders/:id (ADR-O1) — the thin order reference (id/quoteId/
    // orderNumber/status/dates, NO money), role-independent so it is honest on
    // the price-blind production route. Sourced so the workshop detail breadcrumb
    // can show the ORDER number the user clicked, not the underlying quote's
    // evidenční číslo (the production snapshot carries only the quote number).
    order: (id: string) =>
      defineQuery<OrderDetail>(client, {
        queryKey: orderKeys.detail(id),
        path: `/v1/orders/${id}`,
        schema: (data) => orderSchema.parse(data),
      }),

    // GET /v1/orders/:id/production (ADR-O1) — the re-homed workshop build view:
    // cut list/BOM quantities/drawings off the order's frozen quote snapshot,
    // role-independent + always price-blind (identical shape to the quote-keyed
    // read; the api reuses `quoteProductionSchema` verbatim).
    production: (id: string) =>
      defineQuery<QuoteProduction>(client, {
        queryKey: orderKeys.production(id),
        path: `/v1/orders/${id}/production`,
        schema: (data) => quoteProductionSchema.parse(data),
      }),
  };
}
