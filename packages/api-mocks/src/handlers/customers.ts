import { createCustomerSchema, type Customer } from "@repo/validators";

import { MockHttpError, type MockRoute } from "../core/types";
import { insertCustomerFixture, listCustomerFixtures } from "../fixtures/customers";

/**
 * Customers mock routes (ADR 0082) — list + create, enough for the quote
 * issue-flow picker. Single-tenant mock; the real API applies org + per-rep scope.
 */
function paginate(
  items: Customer[],
  searchParams: URLSearchParams,
): { items: Customer[]; nextCursor: string | null } {
  const limitRaw = Number(searchParams.get("limit") ?? "20");
  const limit = Math.min(100, Math.max(1, Number.isFinite(limitRaw) ? limitRaw : 20));
  const cursor = searchParams.get("cursor");
  let rows = [...items].sort((a, b) => b.id.localeCompare(a.id));
  if (cursor) {
    const index = rows.findIndex((c) => c.id === cursor);
    rows = index >= 0 ? rows.slice(index + 1) : rows;
  }
  const page = rows.slice(0, limit);
  const nextCursor = rows.length > limit ? (page[page.length - 1]?.id ?? null) : null;
  return { items: page, nextCursor };
}

export const customerRoutes: MockRoute[] = [
  {
    method: "GET",
    pattern: "/v1/customers",
    handler: ({ searchParams }) => ({ data: paginate(listCustomerFixtures(), searchParams) }),
  },
  {
    method: "POST",
    pattern: "/v1/customers",
    handler: async ({ getBody }) => {
      const parsed = createCustomerSchema.safeParse(await getBody());
      if (!parsed.success) throw new MockHttpError(422, "INVALID_INPUT", "Invalid customer input");
      return { data: insertCustomerFixture(parsed.data), status: 201 };
    },
  },
];
