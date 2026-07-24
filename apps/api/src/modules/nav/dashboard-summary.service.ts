import { Injectable } from "@nestjs/common";

import { isPriceBlind, type OrgRole } from "../../common/rbac/org-role.js";
import { type RequestScope } from "../../common/tenancy/request-scope.js";
import { OrdersService, type RecentOrderActivity } from "../orders/orders.service.js";
import {
  QuotesService,
  type ExpiringQuoteSummary,
  type RecentQuoteActivity,
} from "../quotes/quotes.service.js";

/**
 * The owner "Přehled" dashboard aggregate (ADR 0125) — the payload
 * `GET /v1/me/dashboard-summary` returns. Shape MIRRORS
 * `dashboardSummaryResponseSchema` (`@repo/validators/dashboard-summary`), the FE
 * trust-boundary parser — a plain interface here, exactly as `nav-counts` mirrors
 * its schema (the zod parse is applied on the FE, not server-side).
 *
 * CONTRACT-HONESTY (Phase 2, Wave D): an honest SUBTRACTION of the design canvas
 * — only fields a real backend source backs. Deliberately NO leads/Poptávky (no
 * leads module — `nav-counts` never emits it either), NO revenue/Vyfakturováno/
 * Tržby/money-total (invoices are not adoption-wired; revenue is never
 * fabricated), NO deposit, NO scheduling/Nadcházející field.
 *
 * ROLE-FILTERED via OPTIONAL keys (the `nav-counts` convention: an absent key is
 * "not shown", never a zero placeholder). The price-blind `workshop` role
 * (`isPriceBlind`, ADR 0056) gets ONLY `kpis.activeOrders` + orders-only
 * `activity` — no quotes KPI, no funnel, no expiring-quotes, no money anywhere.
 * admin/sales get the full shape; a `sales` caller's quote-derived numbers are
 * owner-narrowed inside `QuotesService` (ADR 0082).
 */

/** Statuses derived from the surface services — the union the wire status field
 *  carries, without a direct `@repo/db/schema` import (ADR 0032: the nav module
 *  owns no schema and reads only through the exported services). */
type ActivityStatus = RecentOrderActivity["status"] | RecentQuoteActivity["status"];

interface DashboardKpis {
  /** Active orders — `confirmed` + `in_production`. Always present (every role). */
  activeOrders: number;
  /** Open quotes needing attention — `draft` + `issued`. Non-workshop only. */
  openQuotes?: number;
  /** Accepted quotes (won deals). Non-workshop only. */
  acceptedQuotes?: number;
  /** Issued quotes lapsing within the near horizon. Non-workshop only. */
  expiringSoon?: number;
}

/** The scoped 2-stage sales funnel (non-workshop) — open quotes → active orders.
 *  Honest 2-stage ONLY: no leads stage, no invoiced stage. */
interface DashboardFunnel {
  quotes: number;
  orders: number;
}

interface DashboardExpiringQuote {
  id: string;
  number: string | null;
  validUntil: string | null;
  status: ExpiringQuoteSummary["status"];
  /** Decimal-string money (I10). Non-workshop only (the whole widget is dropped
   *  for the price-blind role, so this never reaches the workshop). */
  total: string | null;
}

export interface DashboardActivityItem {
  kind: "order" | "quote";
  id: string;
  number: string | null;
  status: ActivityStatus;
  updatedAt: string;
}

export interface DashboardSummary {
  kpis: DashboardKpis;
  funnel?: DashboardFunnel;
  expiringQuotes?: DashboardExpiringQuote[];
  activity: DashboardActivityItem[];
}

/** How many merged activity rows the feed shows (and how many to fetch per
 *  surface before the merge-sort). */
const ACTIVITY_LIMIT = 8;
/** How many soonest-to-lapse quotes the expiring-quotes widget lists. */
const EXPIRING_QUOTES_LIMIT = 5;
/** The "expiring soon" KPI horizon — issued quotes lapsing within this window. */
const EXPIRING_SOON_HORIZON_DAYS = 14;

/**
 * Read-only aggregator for the owner dashboard (ADR 0125). Owns no table — it
 * fans the caller's scope out to the surface-owning services (cross-module reads
 * through their exported services, never a schema join, ADR 0032) and
 * role-filters exactly as `nav-counts` does, so a price-blind caller can never
 * receive a priced field.
 */
@Injectable()
export class DashboardSummaryService {
  constructor(
    private readonly quotes: QuotesService,
    private readonly orders: OrdersService,
  ) {}

  /** The dashboard the caller (org `scope` + `role`) may see. Orders are
   *  org-visible to every role; the quotes-derived surfaces are non-workshop only
   *  and owner-narrowed for `sales` inside `QuotesService`. */
  async forCaller(scope: RequestScope, role: OrgRole): Promise<DashboardSummary> {
    // Orders: visible to every role (the workshop sees orders, not quotes).
    const [activeOrders, orderActivity] = await Promise.all([
      this.orders.countActive(scope),
      this.orders.listRecent(scope, ACTIVITY_LIMIT),
    ]);

    // Workshop is price-blind: the deliberately-sparse subset — the active-orders
    // KPI + orders-only activity, and NOTHING else. No quotes KPI, no funnel, no
    // expiring-quotes widget, no money (mirrors nav-counts dropping the quotes pill).
    if (isPriceBlind(role)) {
      return {
        kpis: { activeOrders },
        activity: this.mergeActivity(orderActivity, []),
      };
    }

    // admin/sales: the full shape. Every quotes-derived number is owner-narrowed
    // for sales inside QuotesService (ADR 0082).
    const [openQuotes, acceptedQuotes, expiringSoon, expiring, quoteActivity] = await Promise.all([
      this.quotes.countOpen(scope, role),
      this.quotes.countByStatuses(scope, role, ["accepted"]),
      this.quotes.countExpiringSoon(scope, role, EXPIRING_SOON_HORIZON_DAYS),
      this.quotes.listExpiring(scope, role, EXPIRING_QUOTES_LIMIT),
      this.quotes.listRecent(scope, role, ACTIVITY_LIMIT),
    ]);

    return {
      kpis: { activeOrders, openQuotes, acceptedQuotes, expiringSoon },
      // The honest 2-stage funnel reuses the counts already computed — open
      // quotes (Nabídky) → active orders (Objednáno).
      funnel: { quotes: openQuotes, orders: activeOrders },
      expiringQuotes: expiring.map((e) => ({
        id: e.id,
        number: e.number,
        validUntil: e.validUntil ? e.validUntil.toISOString() : null,
        status: e.status,
        total: e.total,
      })),
      activity: this.mergeActivity(orderActivity, quoteActivity),
    };
  }

  /** Merge recent orders + quotes into one feed, newest-first, capped at
   *  `ACTIVITY_LIMIT`. Built from `updatedAt` only — NEVER the audit trail (the
   *  audit module's CONTEXT.md forbids cross-module audit reads). Carries no money. */
  private mergeActivity(
    orders: RecentOrderActivity[],
    quotes: RecentQuoteActivity[],
  ): DashboardActivityItem[] {
    const merged: Array<{ item: Omit<DashboardActivityItem, "updatedAt">; updatedAt: Date }> = [
      ...orders.map((o) => ({
        item: { kind: "order" as const, id: o.id, number: o.number, status: o.status },
        updatedAt: o.updatedAt,
      })),
      ...quotes.map((q) => ({
        item: { kind: "quote" as const, id: q.id, number: q.number, status: q.status },
        updatedAt: q.updatedAt,
      })),
    ];
    return merged
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .slice(0, ACTIVITY_LIMIT)
      .map((m) => ({ ...m.item, updatedAt: m.updatedAt.toISOString() }));
  }
}
