import { createCustomerSchema, updateCustomerSchema, type Customer } from "@repo/validators";

import { MockHttpError, type MockRoute } from "../core/types";
import {
  findCustomerFixture,
  insertCustomerFixture,
  listCustomerFixtures,
  updateCustomerFixture,
} from "../fixtures/customers";

/**
 * Customers mock routes (ADR 0082/CAR-23) — list/create (the quote issue-flow
 * picker) plus get/update (the `/customers` management surface). Single-tenant
 * mock; the real API applies org + per-rep scope. `search` mirrors the API's
 * case-insensitive name/IČO substring filter; `status` filters like `projects`.
 */
function paginate(
  items: Customer[],
  searchParams: URLSearchParams,
): { items: Customer[]; nextCursor: string | null } {
  const status = searchParams.get("status");
  const search = searchParams.get("search")?.trim().toLowerCase();
  const limitRaw = Number(searchParams.get("limit") ?? "20");
  const limit = Math.min(100, Math.max(1, Number.isFinite(limitRaw) ? limitRaw : 20));
  const cursor = searchParams.get("cursor");

  let rows = status ? items.filter((c) => c.status === status) : items;
  if (search) {
    rows = rows.filter(
      (c) => c.name.toLowerCase().includes(search) || (c.ico ?? "").toLowerCase().includes(search),
    );
  }
  rows = [...rows].sort((a, b) => b.id.localeCompare(a.id));
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
  {
    method: "GET",
    pattern: "/v1/customers/:id",
    handler: ({ params }) => {
      const found = findCustomerFixture(params.id ?? "");
      if (!found) throw new MockHttpError(404, "NOT_FOUND", "Customer not found");
      return { data: found };
    },
  },
  {
    method: "PATCH",
    pattern: "/v1/customers/:id",
    handler: async ({ params, getBody }) => {
      const parsed = updateCustomerSchema.safeParse(await getBody());
      if (!parsed.success) throw new MockHttpError(422, "INVALID_INPUT", "Invalid customer input");
      const updated = updateCustomerFixture(params.id ?? "", parsed.data);
      if (!updated) throw new MockHttpError(404, "NOT_FOUND", "Customer not found");
      return { data: updated };
    },
  },
];
