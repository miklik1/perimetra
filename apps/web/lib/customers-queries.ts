import { defineInfiniteQuery, mutationOptions } from "@repo/api";
import type { ApiClient } from "@repo/api";
import { appendSearchParams, stableParams, type SearchParamsInput } from "@repo/utils";
import {
  createCustomerSchema,
  customerSchema,
  customersPageSchema,
  type CreateCustomerInput,
  type Customer,
  type CustomersPage,
} from "@repo/validators";

/**
 * Customers endpoint factory + key tier (ADR 0082) — list + create, enough for
 * the quote issue-flow picker. App-side consumption layer.
 */
export const customerKeys = {
  all: ["customers"] as const,
  lists: () => [...customerKeys.all, "list"] as const,
  list: (filters?: SearchParamsInput) => [...customerKeys.lists(), stableParams(filters)] as const,
} as const;

export interface CreateCustomerVariables {
  input: CreateCustomerInput;
  idempotencyKey: string;
}

export function createCustomersQueries(client: ApiClient) {
  return {
    list: (filters?: { limit?: number; status?: "active" | "archived" }) =>
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
  };
}
