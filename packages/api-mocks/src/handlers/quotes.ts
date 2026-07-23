import { issueQuoteSchema, type QuoteSummary } from "@repo/validators";

import { MockHttpError, type MockRoute } from "../core/types";
import {
  findQuoteByShareToken,
  findQuoteFixture,
  findSharedNabidkaFixture,
  insertQuoteFixture,
  listQuoteFixtures,
  setQuoteStatusFixture,
  verifyQuoteFixture,
} from "../fixtures/quotes";

/**
 * Quotes mock routes (ADR 0018) over the /v1/quotes contract: keyset list,
 * detail, issue (201), the I3 verify path, and the PUBLIC buyer accept/decline
 * via shareToken (ADR 0083). Single-tenant mock — per-rep/org scoping is a no-op
 * here; the real API filters.
 */
function paginate(
  items: QuoteSummary[],
  searchParams: URLSearchParams,
): { items: QuoteSummary[]; nextCursor: string | null } {
  const status = searchParams.get("status");
  const sort = searchParams.get("sort") === "createdAt:asc" ? "asc" : "desc";
  const limitRaw = Number(searchParams.get("limit") ?? "20");
  const limit = Math.min(100, Math.max(1, Number.isFinite(limitRaw) ? limitRaw : 20));
  const cursor = searchParams.get("cursor");

  let rows = status ? items.filter((q) => q.status === status) : items;
  rows = [...rows].sort((a, b) =>
    sort === "asc" ? a.id.localeCompare(b.id) : b.id.localeCompare(a.id),
  );
  if (cursor) {
    const index = rows.findIndex((q) => q.id === cursor);
    rows = index >= 0 ? rows.slice(index + 1) : rows;
  }
  const page = rows.slice(0, limit);
  const nextCursor = rows.length > limit ? (page[page.length - 1]?.id ?? null) : null;
  return { items: page, nextCursor };
}

export const quoteRoutes: MockRoute[] = [
  {
    method: "GET",
    pattern: "/v1/quotes",
    handler: ({ searchParams }) => ({ data: paginate(listQuoteFixtures(), searchParams) }),
  },
  {
    method: "POST",
    pattern: "/v1/quotes",
    handler: async ({ getBody }) => {
      const parsed = issueQuoteSchema.safeParse(await getBody());
      if (!parsed.success) throw new MockHttpError(422, "INVALID_INPUT", "Invalid issue input");
      const quote = insertQuoteFixture({
        ...(parsed.data.customerId !== undefined ? { customerId: parsed.data.customerId } : {}),
        ...(parsed.data.tax !== undefined ? { tax: parsed.data.tax } : {}),
      });
      return { data: quote, status: 201 };
    },
  },
  {
    // Buyer-facing public nabídka by shareToken (ADR 0089). The matcher keys on
    // segment count, so `/v1/quotes/shared/:token` (4) never collides with
    // `/v1/quotes/:id` (3) regardless of declaration order.
    method: "GET",
    pattern: "/v1/quotes/shared/:shareToken",
    handler: ({ params }) => {
      const result = findSharedNabidkaFixture(params.shareToken ?? "");
      if (!result) throw new MockHttpError(404, "NOT_FOUND", "Quote not found");
      return { data: result };
    },
  },
  {
    method: "GET",
    pattern: "/v1/quotes/:id",
    handler: ({ params }) => {
      const quote = findQuoteFixture(params.id ?? "");
      if (!quote) throw new MockHttpError(404, "NOT_FOUND", "Quote not found");
      return { data: quote };
    },
  },
  {
    method: "POST",
    pattern: "/v1/quotes/:id/verify",
    handler: ({ params }) => {
      const result = verifyQuoteFixture(params.id ?? "");
      if (!result) throw new MockHttpError(404, "NOT_FOUND", "Quote not found");
      return { data: result };
    },
  },
  {
    method: "POST",
    pattern: "/v1/quotes/shared/:shareToken/accept",
    handler: ({ params }) => {
      const quote = findQuoteByShareToken(params.shareToken ?? "");
      if (!quote) throw new MockHttpError(404, "NOT_FOUND", "Quote not found");
      // Mirrors the real service's supersession guard (ADR-O1/CAR-158): checked
      // BEFORE the generic "not open" 409, and carries no `status` field — the
      // buyer view's `isSupersededConflict` keys on the code alone.
      if (quote.supersededById) {
        throw new MockHttpError(409, "quote_superseded", "Quote has been superseded");
      }
      const result = setQuoteStatusFixture(params.shareToken ?? "", "accepted");
      if (!result) throw new MockHttpError(409, "QUOTE_NOT_OPEN", "Quote is not open");
      return { data: result };
    },
  },
  {
    method: "POST",
    pattern: "/v1/quotes/shared/:shareToken/decline",
    handler: ({ params }) => {
      const quote = findQuoteByShareToken(params.shareToken ?? "");
      if (!quote) throw new MockHttpError(404, "NOT_FOUND", "Quote not found");
      if (quote.supersededById) {
        throw new MockHttpError(409, "quote_superseded", "Quote has been superseded");
      }
      const result = setQuoteStatusFixture(params.shareToken ?? "", "declined");
      if (!result) throw new MockHttpError(409, "QUOTE_NOT_OPEN", "Quote is not open");
      return { data: result };
    },
  },
];
