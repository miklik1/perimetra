import { describe, expect, it, vi } from "vitest";

import { type RequestScope } from "../../common/tenancy/request-scope.js";
import { type OrdersService } from "../orders/orders.service.js";
import { type QuotesService } from "../quotes/quotes.service.js";
import { NavCountsService } from "./nav-counts.service.js";

/** A minimal double of each surface service — only the count method matters. */
function make(quotesCount: number, ordersCount: number) {
  const quotes = { countOpen: vi.fn(async () => quotesCount) };
  const orders = { countActive: vi.fn(async () => ordersCount) };
  const service = new NavCountsService(
    quotes as unknown as QuotesService,
    orders as unknown as OrdersService,
  );
  return { service, quotes, orders };
}

const scope = { organizationId: "org-1", userId: "u-1" } as RequestScope;

describe("NavCountsService.forCaller", () => {
  it("gives an admin both the quote (whole-org) and order counts", async () => {
    const { service, quotes } = make(3, 5);
    expect(await service.forCaller(scope, "admin")).toStrictEqual({ quotes: 3, orders: 5 });
    // Delegates the ownership narrowing to the quotes service by passing the role.
    expect(quotes.countOpen).toHaveBeenCalledWith(scope, "admin");
  });

  it("gives a sales rep the quote count (narrowed to their own) and orders", async () => {
    const { service, quotes } = make(2, 4);
    expect(await service.forCaller(scope, "sales")).toStrictEqual({ quotes: 2, orders: 4 });
    expect(quotes.countOpen).toHaveBeenCalledWith(scope, "sales");
  });

  it("hides the quotes pill from a price-blind workshop role — orders only", async () => {
    const { service, quotes } = make(9, 7);
    expect(await service.forCaller(scope, "workshop")).toStrictEqual({ orders: 7 });
    // The priced surface is never even queried for a workshop caller.
    expect(quotes.countOpen).not.toHaveBeenCalled();
  });

  it("never emits `leads` (no module yet — an empty pill is worse than none)", async () => {
    const { service } = make(1, 1);
    expect("leads" in (await service.forCaller(scope, "admin"))).toBe(false);
  });
});
