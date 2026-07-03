import { defineInfiniteQuery, defineMutation, defineQuery, mutationOptions } from "@repo/api";
import type { ApiClient } from "@repo/api";
import { appendSearchParams, stableParams, type SearchParamsInput } from "@repo/utils";
import {
  issueQuoteSchema,
  quoteProductionSchema,
  quoteReproductionSchema,
  quoteSchema,
  quotesPageSchema,
  type IssueQuoteInput,
  type QuoteDetail,
  type QuoteProduction,
  type QuoteReproduction,
  type QuotesPage,
} from "@repo/validators";

/**
 * Quotes endpoint factory + key tier (ADR 0007 pattern, mirrors
 * `createProjectsQueries`): list (keyset), detail, the I3 verify action, and
 * issue. App-side consumption layer — promote into `packages/api` if it
 * graduates. Transport rides the same-origin proxy (mock group `quotes` in
 * mock mode, the real `/v1/quotes` with a backend).
 */
const quoteKeys = {
  all: ["quotes"] as const,
  lists: () => [...quoteKeys.all, "list"] as const,
  list: (filters?: SearchParamsInput) => [...quoteKeys.lists(), stableParams(filters)] as const,
  details: () => [...quoteKeys.all, "detail"] as const,
  detail: (id: string) => [...quoteKeys.details(), id] as const,
  productions: () => [...quoteKeys.all, "production"] as const,
  production: (id: string) => [...quoteKeys.productions(), id] as const,
} as const;

export type ListQuotesFilters = {
  limit?: number;
  sort?: "createdAt:asc" | "createdAt:desc";
  status?: "draft" | "issued" | "accepted" | "declined" | "expired";
};

export interface IssueQuoteVariables {
  input: IssueQuoteInput;
  /** One uuid per submit attempt-chain — the server's Idempotency-Key dedupe. */
  idempotencyKey: string;
}

export function createQuotesQueries(client: ApiClient) {
  return {
    list: (filters?: ListQuotesFilters) =>
      defineInfiniteQuery<QuotesPage, string>(client, {
        queryKey: quoteKeys.list(filters),
        initialPageParam: "",
        path: (cursor) =>
          appendSearchParams("/v1/quotes", { ...filters, cursor: cursor || undefined }),
        schema: (data) => quotesPageSchema.parse(data),
        getNextPageParam: (lastPage) => lastPage.nextCursor,
      }),

    detail: (id: string) =>
      defineQuery<QuoteDetail>(client, {
        queryKey: quoteKeys.detail(id),
        path: `/v1/quotes/${id}`,
        schema: (data) => quoteSchema.parse(data),
      }),

    // GET /v1/quotes/:id/production (CAR-24) — the workshop build view: cut
    // list/BOM quantities/drawings off the frozen snapshot, role-independent
    // (every caller gets the identical price-blind shape, so no priceBlind flag
    // to thread here unlike `detail`).
    production: (id: string) =>
      defineQuery<QuoteProduction>(client, {
        queryKey: quoteKeys.production(id),
        path: `/v1/quotes/${id}/production`,
        schema: (data) => quoteProductionSchema.parse(data),
      }),

    // POST /v1/quotes/:id/verify — re-derive from stamps, returns the I3 result.
    verify: () =>
      defineMutation<QuoteReproduction, string>(client, {
        method: "POST",
        path: (id) => `/v1/quotes/${id}/verify`,
        body: () => undefined,
        schema: (data) => quoteReproductionSchema.parse(data),
      }),

    // POST /v1/quotes (201) — issue. Idempotency-Key is per-call state the
    // builder doesn't model, so this is hand-rolled (like projects.create).
    issue: () =>
      mutationOptions({
        mutationFn: ({ input, idempotencyKey }: IssueQuoteVariables) =>
          client.apiFetch<QuoteDetail>("/v1/quotes", {
            method: "POST",
            body: issueQuoteSchema.parse(input),
            headers: { "Idempotency-Key": idempotencyKey },
            parse: (data) => quoteSchema.parse(data),
          }) as Promise<QuoteDetail>,
      }),
  };
}
