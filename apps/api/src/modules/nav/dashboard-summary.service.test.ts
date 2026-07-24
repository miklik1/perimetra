import { describe, expect, it, vi } from "vitest";

import { type RequestScope } from "../../common/tenancy/request-scope.js";
import { type OrdersService, type RecentOrderActivity } from "../orders/orders.service.js";
import {
  type ExpiringQuoteSummary,
  type QuotesService,
  type RecentQuoteActivity,
} from "../quotes/quotes.service.js";
import { DashboardSummaryService } from "./dashboard-summary.service.js";

/** Fixed activity fixtures — distinct `updatedAt` so the merge-sort is provable
 *  (the quote is newer than the order). */
const orderActivity: RecentOrderActivity = {
  id: "o-1",
  number: "Z2026/0001",
  status: "confirmed",
  updatedAt: new Date("2026-07-20T10:00:00.000Z"),
};
const quoteActivity: RecentQuoteActivity = {
  id: "q-1",
  number: "2026/0001",
  status: "issued",
  updatedAt: new Date("2026-07-22T10:00:00.000Z"),
};
const expiringQuote: ExpiringQuoteSummary = {
  id: "q-1",
  number: "2026/0001",
  validUntil: new Date("2026-08-01T00:00:00.000Z"),
  status: "issued",
  total: "134723.5",
};

/** Minimal doubles of each surface service — only the methods the aggregator
 *  calls matter (vi.fn casts, mirroring nav-counts.service.test.ts). */
function make() {
  const quotes = {
    countOpen: vi.fn(async () => 3),
    countByStatuses: vi.fn(async () => 2),
    countExpiringSoon: vi.fn(async () => 1),
    listExpiring: vi.fn(async () => [expiringQuote]),
    listRecent: vi.fn(async () => [quoteActivity]),
  };
  const orders = {
    countActive: vi.fn(async () => 5),
    listRecent: vi.fn(async () => [orderActivity]),
  };
  const service = new DashboardSummaryService(
    quotes as unknown as QuotesService,
    orders as unknown as OrdersService,
  );
  return { service, quotes, orders };
}

const scope = { organizationId: "org-1", userId: "u-1" } as RequestScope;

describe("DashboardSummaryService.forCaller", () => {
  it("gives an admin the full shape — KPIs, funnel, expiring quotes (with money), merged activity", async () => {
    const { service, quotes } = make();
    const result = await service.forCaller(scope, "admin");

    expect(result.kpis).toStrictEqual({
      activeOrders: 5,
      openQuotes: 3,
      acceptedQuotes: 2,
      expiringSoon: 1,
    });
    // The 2-stage funnel reuses the counts: open quotes → active orders.
    expect(result.funnel).toStrictEqual({ quotes: 3, orders: 5 });
    // The expiring widget carries money for a non-price-blind caller.
    expect(result.expiringQuotes).toEqual([
      {
        id: "q-1",
        number: "2026/0001",
        validUntil: "2026-08-01T00:00:00.000Z",
        status: "issued",
        total: "134723.5",
      },
    ]);
    // Activity merges orders + quotes, newest-first (the quote is newer), ISO dates.
    expect(result.activity).toEqual([
      {
        kind: "quote",
        id: "q-1",
        number: "2026/0001",
        status: "issued",
        updatedAt: "2026-07-22T10:00:00.000Z",
      },
      {
        kind: "order",
        id: "o-1",
        number: "Z2026/0001",
        status: "confirmed",
        updatedAt: "2026-07-20T10:00:00.000Z",
      },
    ]);
    // The whole-org quote count (admin is not owner-narrowed).
    expect(quotes.countOpen).toHaveBeenCalledWith(scope, "admin");
  });

  it("owner-narrows a sales rep — every quotes read is delegated the 'sales' role", async () => {
    const { service, quotes } = make();
    const result = await service.forCaller(scope, "sales");

    // Full shape (sales sees prices), but the narrowing is delegated to the
    // quotes service by passing the role (ADR 0082) — it decides own-vs-org.
    expect(result.funnel).toBeDefined();
    expect(result.expiringQuotes).toBeDefined();
    expect(quotes.countOpen).toHaveBeenCalledWith(scope, "sales");
    expect(quotes.countByStatuses).toHaveBeenCalledWith(scope, "sales", ["accepted"]);
    expect(quotes.listExpiring).toHaveBeenCalledWith(scope, "sales", expect.any(Number));
    expect(quotes.listRecent).toHaveBeenCalledWith(scope, "sales", expect.any(Number));
  });

  it("strips the price-blind workshop to active-orders KPI + orders-only activity — no quotes/funnel/expiring/money", async () => {
    const { service, quotes, orders } = make();
    const result = await service.forCaller(scope, "workshop");

    // ONLY the active-orders KPI — no quotes-derived KPI keys at all.
    expect(result.kpis).toStrictEqual({ activeOrders: 5 });
    expect("openQuotes" in result.kpis).toBe(false);
    expect("acceptedQuotes" in result.kpis).toBe(false);
    expect("expiringSoon" in result.kpis).toBe(false);
    // The priced surfaces are absent (not empty) — nav-counts convention.
    expect(result.funnel).toBeUndefined();
    expect(result.expiringQuotes).toBeUndefined();
    // Orders-only activity (no quote row merged in).
    expect(result.activity).toEqual([
      {
        kind: "order",
        id: "o-1",
        number: "Z2026/0001",
        status: "confirmed",
        updatedAt: "2026-07-20T10:00:00.000Z",
      },
    ]);
    // The priced surface is never even queried for a workshop caller.
    expect(quotes.countOpen).not.toHaveBeenCalled();
    expect(quotes.countByStatuses).not.toHaveBeenCalled();
    expect(quotes.countExpiringSoon).not.toHaveBeenCalled();
    expect(quotes.listExpiring).not.toHaveBeenCalled();
    expect(quotes.listRecent).not.toHaveBeenCalled();
    // Orders are still read (org-visible to every role).
    expect(orders.countActive).toHaveBeenCalledWith(scope);
  });
});
