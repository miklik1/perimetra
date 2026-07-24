import { defineInfiniteQuery, defineMutation, defineQuery, mutationOptions } from "@repo/api";
import type { ApiClient } from "@repo/api";
import { appendSearchParams, stableParams, type SearchParamsInput } from "@repo/utils";
import {
  invoiceDocumentSchema,
  invoiceReproductionSchema,
  invoiceSchema,
  invoicesPageSchema,
  issueInvoiceSchema,
  type Invoice,
  type InvoiceDocument,
  type InvoiceReproduction,
  type InvoicesPage,
  type InvoiceStatus,
  type IssueInvoiceInput,
  type MarkInvoicePaidInput,
} from "@repo/validators";

/**
 * Invoices endpoint factory + key tier (ADR 0007 pattern, mirrors
 * `createQuotesQueries`): the keyset list, the row detail, the FROZEN §29
 * document read (ADR 0127), the I3 verify action, the two payment row-state
 * mutations and issue. App-side consumption layer; transport rides the
 * same-origin proxy (mock group `invoices`, or the real `/v1/invoices`).
 *
 * Two money classes ride this factory and must never be mixed on one number:
 * `InvoiceSummary.total` / `Invoice.total` are I10 decimal koruna strings for
 * `formatMoney`, while every amount inside `InvoiceDocument` is the KERNEL's
 * `formatCents` output and is rendered VERBATIM on the print sheet. Money
 * formatting is kernel-owned (the 2026-07-14 no-duplication ruling).
 */
const invoiceKeys = {
  all: ["invoices"] as const,
  lists: () => [...invoiceKeys.all, "list"] as const,
  list: (filters?: SearchParamsInput) => [...invoiceKeys.lists(), stableParams(filters)] as const,
  details: () => [...invoiceKeys.all, "detail"] as const,
  detail: (id: string) => [...invoiceKeys.details(), id] as const,
  documents: () => [...invoiceKeys.all, "document"] as const,
  document: (id: string) => [...invoiceKeys.documents(), id] as const,
} as const;
export { invoiceKeys };

export type ListInvoicesFilters = {
  limit?: number;
  sort?: "createdAt:asc" | "createdAt:desc";
  status?: InvoiceStatus;
};

export interface IssueInvoiceVariables {
  input: IssueInvoiceInput;
  /** One uuid per submit attempt-chain — the server's Idempotency-Key dedupe. */
  idempotencyKey: string;
}

export interface MarkInvoicePaidVariables {
  id: string;
  input: MarkInvoicePaidInput;
}

export function createInvoicesQueries(client: ApiClient) {
  return {
    // GET /v1/invoices — keyset, mirrors createQuotesQueries.list exactly.
    list: (filters?: ListInvoicesFilters) =>
      defineInfiniteQuery<InvoicesPage, string>(client, {
        queryKey: invoiceKeys.list(filters),
        initialPageParam: "",
        path: (cursor) =>
          appendSearchParams("/v1/invoices", { ...filters, cursor: cursor || undefined }),
        schema: (data) => invoicesPageSchema.parse(data),
        getNextPageParam: (lastPage) => lastPage.nextCursor,
      }),

    detail: (id: string) =>
      defineQuery<Invoice>(client, {
        queryKey: invoiceKeys.detail(id),
        path: `/v1/invoices/${id}`,
        schema: (data) => invoiceSchema.parse(data),
      }),

    // GET /v1/invoices/:id/document (ADR 0127) — the frozen §29 document,
    // already zod-validated api-side; the print surface's only data source. The
    // document layer is SERVED, not shipped: the web must never import
    // `@cardo/tax-cz` (its `/export` index eagerly loads the ISDOC/UBL exporters
    // and therefore native libxmljs2 + saxon-js).
    document: (id: string) =>
      defineQuery<InvoiceDocument>(client, {
        queryKey: invoiceKeys.document(id),
        path: `/v1/invoices/${id}/document`,
        schema: (data) => invoiceDocumentSchema.parse(data),
      }),

    // POST /v1/invoices/:id/verify — re-derive from the frozen facts, returns
    // the I3 result.
    verify: () =>
      defineMutation<InvoiceReproduction, string>(client, {
        method: "POST",
        path: (id) => `/v1/invoices/${id}/verify`,
        body: () => undefined,
        schema: (data) => invoiceReproductionSchema.parse(data),
      }),

    // POST /v1/invoices/:id/mark-paid (admin) — ROW state, never document
    // content: payment must not reach the frozen §29 sheet (ADR 0112 §5).
    markPaid: () =>
      defineMutation<Invoice, MarkInvoicePaidVariables>(client, {
        method: "POST",
        path: (v) => `/v1/invoices/${v.id}/mark-paid`,
        body: (v) => v.input,
        schema: (data) => invoiceSchema.parse(data),
      }),

    // POST /v1/invoices/:id/unmark-paid (admin) — undo the row-state mark.
    unmarkPaid: () =>
      defineMutation<Invoice, string>(client, {
        method: "POST",
        path: (id) => `/v1/invoices/${id}/unmark-paid`,
        body: () => undefined,
        schema: (data) => invoiceSchema.parse(data),
      }),

    // POST /v1/invoices (201) — issue. Idempotency-Key is per-call state the
    // builder doesn't model, so this is hand-rolled (the quotes.issue precedent).
    issue: () =>
      mutationOptions({
        mutationFn: ({ input, idempotencyKey }: IssueInvoiceVariables) =>
          client.apiFetch<Invoice>("/v1/invoices", {
            method: "POST",
            body: issueInvoiceSchema.parse(input),
            headers: { "Idempotency-Key": idempotencyKey },
            parse: (data) => invoiceSchema.parse(data),
          }) as Promise<Invoice>,
      }),
  };
}
