/**
 * Orders service (ADR 0109 / ADR-O1) — the order state machine over a frozen
 * quote. `@Transactional()` on every write: the status change, the outbox event
 * and the audit row commit or roll back as ONE transaction (ADR 0037). Reads
 * stay decorator-free. Events carry IDs only (`{ orderId }`) — handlers re-fetch.
 *
 * The order NEVER copies the quote snapshot — it references it. Creation guards
 * the quote through `QuotesService` (cross-module read, never a schema join,
 * ADR 0032); the production view resolves order → quote → snapshot and reuses
 * the price-blind projection verbatim (I3 untouched).
 */
import { Transactional } from "@nestjs-cls/transactional";
import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";

import { type OrderRow, type OrderStatus } from "@repo/db/schema/orders";
import {
  type CreateOrderInput,
  type ListOrdersQuery,
  type OrderDetail,
  type OrdersPage,
} from "@repo/validators/orders";
import { type QuoteProduction } from "@repo/validators/quotes";

import { type RequestScope } from "../../common/tenancy/request-scope.js";
import { AuditService } from "../audit/audit.service.js";
import { LedgerService } from "../ledger/ledger.service.js";
import { numberingYear } from "../numbering/numbering-year.js";
import { NumberingService } from "../numbering/numbering.service.js";
import { OutboxService } from "../outbox/outbox.service.js";
import { QuotesService } from "../quotes/quotes.service.js";
import { formatOrderNumber } from "./document-number.js";
import { canCancel, canComplete, canRepoint, canStart } from "./order-lifecycle.js";
import { OrdersRepository } from "./orders.repository.js";
import {
  ORDER_CANCELLED,
  ORDER_COMPLETED,
  ORDER_CONFIRMED,
  ORDER_PRODUCTION_STARTED,
} from "./orders.tokens.js";

/** One recent order for the owner dashboard activity feed (ADR 0125). Exported
 *  for the nav-module aggregator (`DashboardSummaryService`). `updatedAt` stays a
 *  `Date` so the aggregator can merge-sort orders + quotes before serializing. */
export interface RecentOrderActivity {
  id: string;
  number: string;
  status: OrderStatus;
  updatedAt: Date;
}

/** DB row → response contract (Dates become ISO strings). */
function toOrder(row: OrderRow): OrderDetail {
  return {
    id: row.id,
    quoteId: row.quoteId,
    orderNumber: row.orderNumber,
    status: row.status,
    cancelReason: row.cancelReason ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** A Postgres unique-violation (23505) on the named constraint — the
 *  `order_quote_active_uq` race backstop surfacing as a clean 409. drizzle-orm
 *  v1 wraps driver errors in `DrizzleQueryError` with the pg error (carrying
 *  `.code`/`.constraint`) on `.cause`, so walk the chain (mirroring
 *  `ssrfBlockedCause`) rather than only inspecting the top-level error. */
function isUniqueViolation(err: unknown, constraint: string): boolean {
  let current: unknown = err;
  while (current instanceof Error) {
    const pg = current as Error & { code?: unknown; constraint?: unknown };
    if (pg.code === "23505" && pg.constraint === constraint) return true;
    current = pg.cause;
  }
  return false;
}

@Injectable()
export class OrdersService {
  constructor(
    private readonly orders: OrdersRepository,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    private readonly quotes: QuotesService,
    private readonly numbering: NumberingService,
    private readonly ledger: LedgerService,
  ) {}

  /** Orders are org-visible to every role (the workshop sees orders, not quotes). */
  async list(scope: RequestScope, query: ListOrdersQuery): Promise<OrdersPage> {
    const { items, nextCursor } = await this.orders.list(scope, query);
    return { items: items.map(toOrder), nextCursor };
  }

  /** Count the org's active orders (`confirmed` + `in_production`) — the
   *  nav-counts pill source (1c-3). Org-scoped; visible to every role. */
  async countActive(scope: RequestScope): Promise<number> {
    return this.orders.countActive(scope);
  }

  /** Top-N recent orders for the owner dashboard activity feed (ADR 0125). Org-
   *  visible to every role (an order is never price-blind — it carries no money).
   *  Returns `Date`s so the aggregator merge-sorts across surfaces then serializes. */
  async listRecent(scope: RequestScope, limit: number): Promise<RecentOrderActivity[]> {
    const rows = await this.orders.listRecent(scope, limit);
    return rows.map((r) => ({
      id: r.id,
      number: r.orderNumber,
      status: r.status,
      updatedAt: r.updatedAt,
    }));
  }

  /** 404 covers both "doesn't exist" and "not yours" — no existence oracle. */
  async get(scope: RequestScope, orderId: string): Promise<OrderDetail> {
    const row = await this.orders.findById(scope, orderId);
    if (!row) throw new NotFoundException("Order not found");
    return toOrder(row);
  }

  /**
   * The re-homed workshop production view: resolve order → quote → frozen
   * snapshot and return the price-blind projection verbatim. Access is gated by
   * the ORDER (org-scoped); the quote read is org-scoped too (same org), so it
   * is not owner-narrowed.
   */
  async getProduction(scope: RequestScope, orderId: string): Promise<QuoteProduction> {
    const row = await this.orders.findById(scope, orderId);
    if (!row) throw new NotFoundException("Order not found");
    return this.quotes.getProductionByQuoteId(scope, row.quoteId);
  }

  /**
   * Cross-module seam for invoice issue (ADR 0112): resolve an order to its
   * frozen commercial basis, guarding it exists (org-scoped) and is NOT
   * cancelled — a cancelled deal has no invoice. Returns the ids the invoices
   * module needs without exposing the order row or a schema join (ADR 0032).
   */
  async assertIssuableForInvoice(
    scope: RequestScope,
    orderId: string,
  ): Promise<{ quoteId: string; orderNumber: string }> {
    const row = await this.orders.findById(scope, orderId);
    if (!row) throw new NotFoundException("Order not found");
    if (row.status === "cancelled") {
      throw new ConflictException({
        message: "order is cancelled, cannot be invoiced",
        code: "order_cancelled",
      });
    }
    return { quoteId: row.quoteId, orderNumber: row.orderNumber };
  }

  /**
   * Create an order from an accepted quote. Guards the quote is effectively
   * `accepted`, org-visible and not superseded, guards that the DEAL has no live
   * order yet, allocates the gap-free order number INSIDE the tx, and lets
   * `order_quote_active_uq` decide a concurrent-create race.
   */
  @Transactional()
  async create(scope: RequestScope, input: CreateOrderInput): Promise<OrderDetail> {
    await this.quotes.assertAcceptedForOrder(scope, input.quoteId);

    // One live order per DEAL, not per quote ROW (ADR 0126). `order_quote_active_uq`
    // is keyed on a single `quote_id`, but `revise()` mints a NEW quote row — so
    // with only the index, a rep could raise one order against the original
    // accepted quote and a second against its accepted revision: two live,
    // separately gap-free-numbered orders for one deal, each looking perfectly
    // legitimate on its own. Widen the check to the quote's whole supersession
    // chain (resolved through `QuotesService` — a cross-module service read, never
    // a schema join, ADR 0032) and refuse with a 409 that NAMES the incumbent
    // order, because the honest remedy is to RE-POINT that order onto the newer
    // revision (ADR-O1, CAR-158), not to raise a second one.
    //
    // The chain deliberately EXCLUDES the quote itself: a duplicate against the
    // SAME row stays the storage layer's job (`order_quote_active_uq` → 409
    // `order_exists` below), which is also the concurrency backstop, so leaving it
    // there keeps that path exercised and the two failures distinguishable.
    //
    // This is an api-layer pre-flight, not an at-rest constraint. Expressing it in
    // the schema needs a `deal_id` (chain-root) column plus a partial unique index
    // — a migration, out of scope for this wave — so a strictly SIMULTANEOUS create
    // against two different rows of the same chain can still slip through. Noted as
    // the follow-up in ADR 0126.
    const siblings = (await this.quotes.chainQuoteIds(scope, input.quoteId)).filter(
      (id) => id !== input.quoteId,
    );
    const incumbent = await this.orders.findLiveByQuoteIds(scope, siblings);
    if (incumbent) {
      throw new ConflictException({
        message: `a live order (${incumbent.orderNumber}) already exists for another revision of this quote`,
        code: "order_exists_for_chain",
        // The typed context goes under `details` — the slot
        // `apiErrorEnvelopeSchema` declares (`GlobalExceptionFilter` does not
        // forward it yet; flagged in ADR 0126). The incumbent's NUMBER is also
        // folded into the message so the rep can act on the refusal today.
        details: {
          orderId: incumbent.id,
          orderNumber: incumbent.orderNumber,
          quoteId: incumbent.quoteId,
        },
      });
    }

    // The series year is PRAGUE's, not the server's (`numberingYear`, ADR 0126):
    // on a UTC box `new Date().getFullYear()` would keep numbering into the old
    // year for the first hour of the Czech New Year, so the order series could
    // disagree with the quote series about the year of the very same deal.
    const year = numberingYear();
    const orderNumber = formatOrderNumber(
      year,
      await this.numbering.allocate(scope, "order", year),
    );

    let row: OrderRow;
    try {
      row = await this.orders.insert(scope, {
        quoteId: input.quoteId,
        orderNumber,
        status: "confirmed",
      });
    } catch (err) {
      if (isUniqueViolation(err, "order_quote_active_uq")) {
        throw new ConflictException({
          message: "an active order already exists for this quote",
          code: "order_exists",
        });
      }
      throw err;
    }

    await this.emit(row.id, ORDER_CONFIRMED);
    await this.audit.record({
      actorId: scope.userId,
      action: "order.confirmed",
      entityType: "order",
      entityId: row.id,
      diff: { before: null, after: { quoteId: row.quoteId, orderNumber } },
    });
    return toOrder(row);
  }

  /**
   * Re-point a confirmed order at a newer accepted revision of the same quote
   * (ADR-O1, CAR-158). Legal only from `confirmed`; the target must be an
   * accepted forward member of the order's supersession chain (guarded by
   * `QuotesService`). Audited before/after — never a silent swap.
   */
  @Transactional()
  async repoint(scope: RequestScope, orderId: string, toQuoteId: string): Promise<OrderDetail> {
    const before = await this.orders.findById(scope, orderId);
    if (!before) throw new NotFoundException("Order not found");
    if (!canRepoint(before.status)) {
      throw new ConflictException({
        message: `order is ${before.status}`,
        code: "order_not_repointable",
        status: before.status,
      });
    }
    await this.quotes.assertRepointTarget(scope, before.quoteId, toQuoteId);

    const row = await this.orders.repoint(scope, orderId, toQuoteId);
    if (!row) throw new NotFoundException("Order not found");

    await this.audit.record({
      actorId: scope.userId,
      action: "order.repointed",
      entityType: "order",
      entityId: orderId,
      diff: { before: { quoteId: before.quoteId }, after: { quoteId: toQuoteId } },
    });
    return toOrder(row);
  }

  /** Workshop or admin starts production (`confirmed → in_production`). */
  @Transactional()
  async start(scope: RequestScope, orderId: string): Promise<OrderDetail> {
    return this.transition(scope, orderId, {
      guard: canStart,
      to: "in_production",
      code: "order_not_startable",
      event: ORDER_PRODUCTION_STARTED,
      action: "order.production_started",
    });
  }

  /** Workshop or admin completes the order (`in_production → completed`). */
  @Transactional()
  async complete(scope: RequestScope, orderId: string): Promise<OrderDetail> {
    return this.transition(scope, orderId, {
      guard: canComplete,
      to: "completed",
      code: "order_not_completable",
      event: ORDER_COMPLETED,
      action: "order.completed",
    });
  }

  /**
   * Admin cancels a non-terminal order (reason required, audited). Cancelling
   * an in-production order strands real cut material — the deviation ledger
   * records that at ADR-O4/CAR-159 (no material-return workflow in v1).
   */
  @Transactional()
  async cancel(scope: RequestScope, orderId: string, reason: string): Promise<OrderDetail> {
    return this.transition(scope, orderId, {
      guard: canCancel,
      to: "cancelled",
      code: "order_not_cancellable",
      event: ORDER_CANCELLED,
      action: "order.cancelled",
      cancelReason: reason,
    });
  }

  /** Shared transition body: load → guard → move status → emit + audit. */
  private async transition(
    scope: RequestScope,
    orderId: string,
    opts: {
      guard: (status: OrderRow["status"]) => boolean;
      to: OrderRow["status"];
      code: string;
      event: string;
      action: string;
      cancelReason?: string;
    },
  ): Promise<OrderDetail> {
    const before = await this.orders.findById(scope, orderId);
    if (!before) throw new NotFoundException("Order not found");
    if (!opts.guard(before.status)) {
      throw new ConflictException({
        message: `order is ${before.status}`,
        code: opts.code,
        status: before.status,
      });
    }

    const row = await this.orders.setStatus(scope, orderId, opts.to, opts.cancelReason);
    if (!row) throw new NotFoundException("Order not found");

    await this.emit(orderId, opts.event);
    await this.audit.record({
      actorId: scope.userId,
      action: opts.action,
      entityType: "order",
      entityId: orderId,
      diff: {
        before: { status: before.status },
        after: {
          status: row.status,
          ...(opts.cancelReason !== undefined && { cancelReason: opts.cancelReason }),
        },
      },
    });
    // Cancelling an in-production order strands real cut material — record it on
    // the deviation ledger (ADR-O4), in this same tx (no material-return in v1).
    if (opts.to === "cancelled" && before.status === "in_production") {
      await this.ledger.recordOrderException(
        scope,
        {
          quoteId: before.quoteId,
          orderId,
          reason: opts.cancelReason ?? "cancelled in production",
        },
        scope.userId,
      );
    }
    return toOrder(row);
  }

  /**
   * Record a production-time exception on an order (ADR-O4, CAR-159) —
   * substituted material, a site deviation, cut-then-changed reality. Admin or
   * workshop; the order must exist (any status). Writes a ledger row directly
   * (the order status is unaffected — reality is recorded, not a transition).
   */
  @Transactional()
  async recordException(
    scope: RequestScope,
    orderId: string,
    reason: string,
    target?: string,
  ): Promise<OrderDetail> {
    const row = await this.orders.findById(scope, orderId);
    if (!row) throw new NotFoundException("Order not found");
    await this.ledger.recordOrderException(
      scope,
      { quoteId: row.quoteId, orderId, reason, ...(target !== undefined && { target }) },
      scope.userId,
    );
    await this.audit.record({
      actorId: scope.userId,
      action: "order.exception",
      entityType: "order",
      entityId: orderId,
      diff: { before: null, after: { reason, ...(target !== undefined && { target }) } },
    });
    return toOrder(row);
  }

  private emit(orderId: string, eventType: string): Promise<string> {
    return this.outbox.emit({
      aggregateType: "order",
      aggregateId: orderId,
      eventType,
      payload: { orderId },
    });
  }
}
