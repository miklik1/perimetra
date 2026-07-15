import { type OrderDetail } from "@repo/validators";

import { type MockRoute } from "../core/types";

/**
 * Orders mock routes (ADR 0018, ADR-O1) over the /v1/orders contract: the keyset
 * list. Single-tenant mock — org scoping is a no-op here; the real API filters.
 * The production view (`/v1/orders/:id/production`) is intentionally NOT mocked
 * (like the quotes production read) — it falls through to the real backend
 * (partial mocking), since it derives off a frozen snapshot the mock doesn't own.
 */
const ORDERS: OrderDetail[] = [
  {
    id: "01920000-0000-7000-8000-000000000001",
    quoteId: "01910000-0000-7000-8000-000000000001",
    orderNumber: "Z2026/0001",
    status: "confirmed",
    cancelReason: null,
    createdAt: "2026-07-01T08:00:00.000Z",
    updatedAt: "2026-07-01T08:00:00.000Z",
  },
  {
    id: "01920000-0000-7000-8000-000000000002",
    quoteId: "01910000-0000-7000-8000-000000000002",
    orderNumber: "Z2026/0002",
    status: "in_production",
    cancelReason: null,
    createdAt: "2026-07-02T08:00:00.000Z",
    updatedAt: "2026-07-03T08:00:00.000Z",
  },
];

function paginate(
  items: OrderDetail[],
  searchParams: URLSearchParams,
): { items: OrderDetail[]; nextCursor: string | null } {
  const status = searchParams.get("status");
  const sort = searchParams.get("sort") === "createdAt:asc" ? "asc" : "desc";
  const limitRaw = Number(searchParams.get("limit") ?? "20");
  const limit = Math.min(100, Math.max(1, Number.isFinite(limitRaw) ? limitRaw : 20));
  const cursor = searchParams.get("cursor");

  let rows = status ? items.filter((o) => o.status === status) : items;
  rows = [...rows].sort((a, b) =>
    sort === "asc" ? a.id.localeCompare(b.id) : b.id.localeCompare(a.id),
  );
  if (cursor) {
    const index = rows.findIndex((o) => o.id === cursor);
    rows = index >= 0 ? rows.slice(index + 1) : rows;
  }
  const page = rows.slice(0, limit);
  const nextCursor = rows.length > limit ? (page[page.length - 1]?.id ?? null) : null;
  return { items: page, nextCursor };
}

export const orderRoutes: MockRoute[] = [
  {
    method: "GET",
    pattern: "/v1/orders",
    handler: ({ searchParams }) => ({ data: paginate(ORDERS, searchParams) }),
  },
];
