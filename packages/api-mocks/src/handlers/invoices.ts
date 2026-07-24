import { issueInvoiceSchema, markInvoicePaidSchema, type Invoice } from "@repo/validators";

import { MockHttpError, type MockRoute } from "../core/types";
import {
  findInvoiceFixture,
  insertInvoiceFixture,
  listInvoiceFixtures,
  setInvoicePaidFixture,
} from "../fixtures/invoices";

/**
 * Invoices mock routes (ADR 0018, ADR 0112 / ADR 0127) over the /v1/invoices
 * contract: keyset list, detail, issue (201), the I3 verify path and the two
 * admin payment row-state actions. Single-tenant mock — org + per-rep scoping is
 * a no-op here; the real API narrows (`scopeOpts(role)`, ADR 0082), so another
 * rep's invoice 404s there and never here.
 *
 * `GET /v1/invoices/:id/document` is intentionally NOT mocked — it derives off a
 * frozen snapshot the mock does not own (the api projects it through the
 * kernel's own `buildPdfViewModel`), so it falls through to the real backend
 * exactly like the quotes/orders production reads (partial mocking).
 */
function paginate(
  items: Invoice[],
  searchParams: URLSearchParams,
): { items: Invoice[]; nextCursor: string | null } {
  const status = searchParams.get("status");
  const sort = searchParams.get("sort") === "createdAt:asc" ? "asc" : "desc";
  const limitRaw = Number(searchParams.get("limit") ?? "20");
  const limit = Math.min(100, Math.max(1, Number.isFinite(limitRaw) ? limitRaw : 20));
  const cursor = searchParams.get("cursor");

  let rows = status ? items.filter((i) => i.status === status) : items;
  rows = [...rows].sort((a, b) =>
    sort === "asc" ? a.id.localeCompare(b.id) : b.id.localeCompare(a.id),
  );
  if (cursor) {
    const index = rows.findIndex((i) => i.id === cursor);
    rows = index >= 0 ? rows.slice(index + 1) : rows;
  }
  const page = rows.slice(0, limit);
  const nextCursor = rows.length > limit ? (page[page.length - 1]?.id ?? null) : null;
  return { items: page, nextCursor };
}

export const invoiceRoutes: MockRoute[] = [
  {
    method: "GET",
    pattern: "/v1/invoices",
    handler: ({ searchParams }) => ({ data: paginate(listInvoiceFixtures(), searchParams) }),
  },
  {
    method: "POST",
    pattern: "/v1/invoices",
    handler: async ({ getBody }) => {
      const parsed = issueInvoiceSchema.safeParse(await getBody());
      if (!parsed.success) throw new MockHttpError(422, "INVALID_INPUT", "Invalid issue input");
      const invoice = insertInvoiceFixture({
        orderId: parsed.data.orderId,
        ...(parsed.data.note !== undefined ? { note: parsed.data.note } : {}),
      });
      return { data: invoice, status: 201 };
    },
  },
  {
    method: "GET",
    pattern: "/v1/invoices/:id",
    handler: ({ params }) => {
      const invoice = findInvoiceFixture(params.id ?? "");
      if (!invoice) throw new MockHttpError(404, "NOT_FOUND", "Invoice not found");
      return { data: invoice };
    },
  },
  {
    method: "POST",
    pattern: "/v1/invoices/:id/verify",
    handler: ({ params }) => {
      const invoice = findInvoiceFixture(params.id ?? "");
      if (!invoice) throw new MockHttpError(404, "NOT_FOUND", "Invoice not found");
      // Verify always reproduces in the mock (the I3 happy path).
      return { data: { invoiceId: invoice.id, reproduced: true, mismatches: [] } };
    },
  },
  {
    method: "POST",
    pattern: "/v1/invoices/:id/mark-paid",
    handler: async ({ params, getBody }) => {
      const parsed = markInvoicePaidSchema.safeParse((await getBody()) ?? {});
      if (!parsed.success) throw new MockHttpError(422, "INVALID_INPUT", "Invalid payment input");
      const invoice = findInvoiceFixture(params.id ?? "");
      if (!invoice) throw new MockHttpError(404, "NOT_FOUND", "Invoice not found");
      // Mirrors the real service's typed transition conflicts — the detail
      // surface toasts these by code rather than as a generic failure.
      if (invoice.status === "paid") {
        throw new MockHttpError(409, "already_paid", "Invoice is already paid");
      }
      const updated = setInvoicePaidFixture(invoice.id, true, parsed.data.note);
      return { data: updated };
    },
  },
  {
    method: "POST",
    pattern: "/v1/invoices/:id/unmark-paid",
    handler: ({ params }) => {
      const invoice = findInvoiceFixture(params.id ?? "");
      if (!invoice) throw new MockHttpError(404, "NOT_FOUND", "Invoice not found");
      if (invoice.status !== "paid") {
        throw new MockHttpError(409, "not_paid", "Invoice is not marked paid");
      }
      const updated = setInvoicePaidFixture(invoice.id, false);
      return { data: updated };
    },
  },
];
