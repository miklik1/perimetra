import { defineInfiniteQuery, defineMutation, defineQuery, mutationOptions } from "@repo/api";
import type { ApiClient } from "@repo/api";
import { appendSearchParams, stableParams, type SearchParamsInput } from "@repo/utils";
import {
  createCustomerSchema,
  customerSchema,
  customersPageSchema,
  updateCustomerSchema,
  type CreateCustomerInput,
  type Customer,
  type CustomersPage,
  type CustomerStatus,
  type UpdateCustomerInput,
} from "@repo/validators";

/**
 * Customers endpoint factory + key tier (ADR 0082) — list/create (the quote
 * issue-flow picker) plus get/update/archive/restore for the dedicated
 * `/customers` management surface (CAR-23). App-side consumption layer.
 */
export const customerKeys = {
  all: ["customers"] as const,
  lists: () => [...customerKeys.all, "list"] as const,
  list: (filters?: SearchParamsInput) => [...customerKeys.lists(), stableParams(filters)] as const,
  details: () => [...customerKeys.all, "detail"] as const,
  detail: (id: string) => [...customerKeys.details(), id] as const,
} as const;

// A type alias (not an interface) so it picks up the implicit index signature
// `SearchParamsInput` requires (interfaces don't) — mirrors `ListProjectsFilters`.
/** List filters — `search` matches name OR IČO, case-insensitive substring (CAR-23). */
export type ListCustomersFilters = {
  limit?: number;
  status?: CustomerStatus;
  search?: string;
};

export interface CreateCustomerVariables {
  input: CreateCustomerInput;
  idempotencyKey: string;
}

export interface UpdateCustomerVariables {
  id: string;
  input: UpdateCustomerInput;
}

export function createCustomersQueries(client: ApiClient) {
  return {
    list: (filters?: ListCustomersFilters) =>
      defineInfiniteQuery<CustomersPage, string>(client, {
        queryKey: customerKeys.list(filters),
        initialPageParam: "",
        path: (cursor) =>
          appendSearchParams("/v1/customers", { ...filters, cursor: cursor || undefined }),
        schema: (data) => customersPageSchema.parse(data),
        getNextPageParam: (lastPage) => lastPage.nextCursor,
      }),

    create: () =>
      mutationOptions({
        mutationFn: ({ input, idempotencyKey }: CreateCustomerVariables) =>
          client.apiFetch<Customer>("/v1/customers", {
            method: "POST",
            body: createCustomerSchema.parse(input),
            headers: { "Idempotency-Key": idempotencyKey },
            parse: (data) => customerSchema.parse(data),
          }) as Promise<Customer>,
      }),

    /** GET /v1/customers/:id — a 404 covers both "missing" and "another rep's" (no oracle). */
    get: (id: string) =>
      defineQuery<Customer>(client, {
        queryKey: customerKeys.detail(id),
        path: `/v1/customers/${id}`,
        schema: (data) => customerSchema.parse(data),
      }),

    /** PATCH /v1/customers/:id — partial update, the full ADR 0082 field set. */
    update: () =>
      defineMutation<Customer, UpdateCustomerVariables>(client, {
        method: "PATCH",
        path: ({ id }) => `/v1/customers/${id}`,
        body: ({ input }) => updateCustomerSchema.parse(input),
        schema: (data) => customerSchema.parse(data),
      }),

    // Archive/restore are a `status`-only PATCH — the REVERSIBLE lifecycle move
    // (ADR 0082's repository doc: "reversible archiving … is a status PATCH
    // instead"). Distinct from the GDPR-erase DELETE (anonymize-in-place),
    // which this management surface does NOT expose (privacy module owns it).
    archive: () =>
      defineMutation<Customer, string>(client, {
        method: "PATCH",
        path: (id) => `/v1/customers/${id}`,
        body: () => ({ status: "archived" }),
        schema: (data) => customerSchema.parse(data),
      }),
    restore: () =>
      defineMutation<Customer, string>(client, {
        method: "PATCH",
        path: (id) => `/v1/customers/${id}`,
        body: () => ({ status: "active" }),
        schema: (data) => customerSchema.parse(data),
      }),
  };
}
