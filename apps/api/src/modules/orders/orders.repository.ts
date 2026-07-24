/**
 * Orders repository (ADR 0109 / ADR-O1) — drizzle queries through the ambient
 * transactional client (`TransactionHost`, ADR 0037). EVERY request-driven
 * method routes its WHERE through `scoped()` (org scope, ADR 0041/0055); the
 * only scope-less method is `findByIdSystem()` (worker handlers, no request).
 *
 * An order is never soft-deleted (cancellation is a status, not a tombstone),
 * so `scoped()` is a pure org filter and there is no `deletedAt` predicate.
 */
import { TransactionHost } from "@nestjs-cls/transactional";
import { type TransactionalAdapterDrizzleOrm } from "@nestjs-cls/transactional-adapter-drizzle-orm";
import { Injectable } from "@nestjs/common";
import { and, asc, count, desc, eq, gt, inArray, lt, ne } from "drizzle-orm";

import { type Db } from "@repo/db";
import { order, type OrderRow, type OrderStatus } from "@repo/db/schema/orders";

import { type RequestScope } from "../../common/tenancy/request-scope.js";

/** The "live build queue" statuses the nav pill counts (1c-3):
 *  `completed`/`cancelled` are terminal, so only these two are in flight. */
const ACTIVE_ORDER_STATUSES = [
  "confirmed",
  "in_production",
] as const satisfies readonly OrderStatus[];

export interface ListOrdersParams {
  cursor?: string | undefined;
  limit: number;
  sort: "createdAt:asc" | "createdAt:desc";
  status?: OrderStatus | undefined;
}

export interface OrdersPageRows {
  items: OrderRow[];
  /** Id of the last returned row when more exist — UUIDv7 keyset cursor. */
  nextCursor: string | null;
}

/** A narrow recent-activity projection (dashboard summary, ADR 0125) — only the
 *  fields the "Přehled" activity feed needs. An order carries no money of its
 *  own, so this is inherently price-safe (no strip needed for any role). */
export interface RecentOrderRow {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  updatedAt: Date;
}

export interface InsertOrderData {
  quoteId: string;
  orderNumber: string;
  status: OrderStatus;
}

@Injectable()
export class OrdersRepository {
  constructor(private readonly txHost: TransactionHost<TransactionalAdapterDrizzleOrm<Db>>) {}

  /** THE access filter (ADR 0041 seam, ADR 0055): org scope. Orders are
   *  org-visible to every role — the workshop sees orders, not quotes — so
   *  there is no owner narrowing here (contrast the quotes repo's opts). */
  private scoped(scope: RequestScope) {
    return eq(order.organizationId, scope.organizationId);
  }

  /** Keyset pagination by id (spec §8): UUIDv7 is time-ordered, so `id < cursor`
   *  walks creation-time descending (`>` ascending). `limit + 1` proves a next page. */
  async list(scope: RequestScope, params: ListOrdersParams): Promise<OrdersPageRows> {
    const ascending = params.sort === "createdAt:asc";
    const rows = await this.txHost.tx
      .select()
      .from(order)
      .where(
        and(
          this.scoped(scope),
          params.status ? eq(order.status, params.status) : undefined,
          params.cursor
            ? ascending
              ? gt(order.id, params.cursor)
              : lt(order.id, params.cursor)
            : undefined,
        ),
      )
      .orderBy(ascending ? asc(order.id) : desc(order.id))
      .limit(params.limit + 1);

    const items = rows.slice(0, params.limit);
    const nextCursor = rows.length > params.limit ? (items.at(-1)?.id ?? null) : null;
    return { items, nextCursor };
  }

  /** Count the org's active orders (`confirmed` + `in_production`) — the nav
   *  pill source (1c-3). Org-scoped, every role (orders are org-visible). */
  async countActive(scope: RequestScope): Promise<number> {
    const [row] = await this.txHost.tx
      .select({ value: count() })
      .from(order)
      .where(and(this.scoped(scope), inArray(order.status, ACTIVE_ORDER_STATUSES)));
    return row?.value ?? 0;
  }

  /** Top-N most-recently-touched orders (dashboard activity feed, ADR 0125) —
   *  org-scoped, every role (orders are org-visible). A fixed-N read, not
   *  paginated; `id` is the deterministic tiebreaker on equal `updatedAt`. */
  async listRecent(scope: RequestScope, limit: number): Promise<RecentOrderRow[]> {
    return this.txHost.tx
      .select({
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        updatedAt: order.updatedAt,
      })
      .from(order)
      .where(this.scoped(scope))
      .orderBy(desc(order.updatedAt), desc(order.id))
      .limit(limit);
  }

  async findById(scope: RequestScope, orderId: string): Promise<OrderRow | null> {
    const [row] = await this.txHost.tx
      .select()
      .from(order)
      .where(and(this.scoped(scope), eq(order.id, orderId)))
      .limit(1);
    return row ?? null;
  }

  /**
   * The org's LIVE order on any of `quoteIds`, if one exists (ADR 0126) — the
   * per-DEAL half of "one live order per quote". `revise()` mints a NEW quote
   * row, so the partial-unique `order_quote_active_uq` (keyed on a single
   * `quote_id`) structurally cannot see that v1 and v2 are the same deal; the
   * service feeds this the quote's whole supersession chain.
   *
   * "Live" is `status <> 'cancelled'`, matching `order_quote_active_uq`'s own
   * predicate EXACTLY — a completed order still occupies its deal (it was built);
   * only a cancellation frees it. Deliberately WIDER than `ACTIVE_ORDER_STATUSES`
   * (the nav pill's in-flight set), which excludes `completed`: the pill counts
   * work, this guards uniqueness.
   *
   * Returns the offending row (not a boolean) so the 409 can NAME the incumbent
   * order and point the rep at re-point instead of a second order.
   */
  async findLiveByQuoteIds(scope: RequestScope, quoteIds: string[]): Promise<OrderRow | null> {
    if (quoteIds.length === 0) return null;
    const [row] = await this.txHost.tx
      .select()
      .from(order)
      .where(
        and(this.scoped(scope), inArray(order.quoteId, quoteIds), ne(order.status, "cancelled")),
      )
      .limit(1);
    return row ?? null;
  }

  /** System-context lookup for worker event handlers (IDs-only payloads,
   *  ADR 0037) — no request scope to apply. NOT for controllers. */
  async findByIdSystem(orderId: string): Promise<OrderRow | null> {
    const [row] = await this.txHost.tx.select().from(order).where(eq(order.id, orderId)).limit(1);
    return row ?? null;
  }

  /** Insert stamps `ownerId`/`organizationId` from scope, spreading `data`
   *  after so a caller cannot override the org scope (field-ordering trick).
   *  A duplicate live order for the quote violates `order_quote_active_uq`
   *  (23505) — the service maps that to 409 `order_exists`. */
  async insert(scope: RequestScope, data: InsertOrderData): Promise<OrderRow> {
    const [row] = await this.txHost.tx
      .insert(order)
      .values({ ownerId: scope.userId, organizationId: scope.organizationId, ...data })
      .returning();
    return row!;
  }

  /** Re-point the order at a newer accepted revision (ADR-O1, CAR-158) — only
   *  the `quoteId` reference moves; the order carries no derived data. */
  async repoint(scope: RequestScope, orderId: string, quoteId: string): Promise<OrderRow | null> {
    const [row] = await this.txHost.tx
      .update(order)
      .set({ quoteId })
      .where(and(this.scoped(scope), eq(order.id, orderId)))
      .returning();
    return row ?? null;
  }

  /** Move only the status field (+ an optional cancel reason). The snapshot the
   *  order references stays byte-frozen — an order carries no derived data. */
  async setStatus(
    scope: RequestScope,
    orderId: string,
    status: OrderStatus,
    cancelReason?: string,
  ): Promise<OrderRow | null> {
    const [row] = await this.txHost.tx
      .update(order)
      .set({ status, ...(cancelReason !== undefined && { cancelReason }) })
      .where(and(this.scoped(scope), eq(order.id, orderId)))
      .returning();
    return row ?? null;
  }
}
