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
import { and, asc, desc, eq, gt, lt } from "drizzle-orm";

import { type Db } from "@repo/db";
import { order, type OrderRow, type OrderStatus } from "@repo/db/schema/orders";

import { type RequestScope } from "../../common/tenancy/request-scope.js";

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

  async findById(scope: RequestScope, orderId: string): Promise<OrderRow | null> {
    const [row] = await this.txHost.tx
      .select()
      .from(order)
      .where(and(this.scoped(scope), eq(order.id, orderId)))
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
