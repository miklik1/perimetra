import { Injectable } from "@nestjs/common";

import { isPriceBlind, type OrgRole } from "../../common/rbac/org-role.js";
import { type RequestScope } from "../../common/tenancy/request-scope.js";
import { OrdersService } from "../orders/orders.service.js";
import { QuotesService } from "../quotes/quotes.service.js";

/**
 * The nav-count badge payload (1c-3) — shape mirrors `navCountsResponseSchema`
 * (`@repo/validators/nav-counts`), the FE trust-boundary parser. A key is
 * present ONLY when the caller may see that surface, so an absent key reads as
 * "no pill", never "zero" (design §4.1).
 */
export interface NavCounts {
  leads?: number;
  quotes?: number;
  orders?: number;
}

/**
 * Read-only aggregator for the app-shell nav pills (1c-3). Owns no table — it
 * fans the caller's scope out to the surface-owning services (cross-module
 * reads through their exported services, never a schema join, ADR 0032) and
 * role-filters exactly as the nav registry does (design §4.3), so a pill can
 * never appear on a surface the caller cannot open.
 */
@Injectable()
export class NavCountsService {
  constructor(
    private readonly quotes: QuotesService,
    private readonly orders: OrdersService,
  ) {}

  /** The counts the caller (org `scope` + `role`) may see. Runs at the caller's
   *  scope, so a `sales` rep's quote count is narrowed to their own rows exactly
   *  as their list is (ADR 0082); the order count is org-wide for every role. */
  async forCaller(scope: RequestScope, role: OrgRole): Promise<NavCounts> {
    const counts: NavCounts = {};
    // Orders: the build queue is visible to every org member (§4.3).
    counts.orders = await this.orders.countActive(scope);
    // Quotes: a priced surface — admin/sales only. A price-blind workshop role
    // never sees Nabídky, so it gets no pill (mirrors the registry predicate).
    if (!isPriceBlind(role)) {
      counts.quotes = await this.quotes.countOpen(scope, role);
    }
    // leads: reserved — the leads module does not exist yet, so it is never
    // emitted (an empty pill is worse than none, §4.1).
    return counts;
  }
}
