/**
 * Invoices repository (ADR 0112) — drizzle queries through the ambient
 * transactional client (`TransactionHost`, ADR 0037): inside a `@Transactional()`
 * service method `tx` IS the issue transaction, so the insert + number allocation
 * + audit + outbox commit or roll back together.
 *
 * An invoice is an IMMUTABLE §29 document: there is no `update`, no `softDelete`.
 * The only post-issue mutations are the payment-status transitions
 * (`markPaid`/`unmarkPaid` — row state, never document content) and the
 * supersede pointer (future correction chain). Every method is org-scoped via
 * `scoped()` (ADR 0041/0055); `findByIdSystem` is the sole scope-less surface
 * (worker handlers re-fetching from an IDs-only payload, ADR 0037).
 */
import { TransactionHost } from "@nestjs-cls/transactional";
import { type TransactionalAdapterDrizzleOrm } from "@nestjs-cls/transactional-adapter-drizzle-orm";
import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq, gt, lt } from "drizzle-orm";

import { type Db } from "@repo/db";
import { invoice, type InvoiceRow, type InvoiceStatus } from "@repo/db/schema/invoices";

import { type RequestScope } from "../../common/tenancy/request-scope.js";

export interface ListInvoicesParams {
  cursor?: string | undefined;
  limit: number;
  sort: "createdAt:asc" | "createdAt:desc";
  status?: InvoiceStatus | undefined;
}

export interface InvoicesPageRows {
  items: InvoiceRow[];
  nextCursor: string | null;
}

/** The frozen columns written at issue (facts/snapshot are the immutable JSONB). */
export interface InsertInvoiceData {
  id: string;
  orderId: string;
  documentNumber: string;
  status: InvoiceStatus;
  currency: string;
  issuedOn: string;
  duzp: string;
  dueOn: string;
  variableSymbol: string;
  totalMoney: string;
  facts: unknown;
  snapshot: unknown;
}

@Injectable()
export class InvoicesRepository {
  constructor(private readonly txHost: TransactionHost<TransactionalAdapterDrizzleOrm<Db>>) {}

  /** THE access filter (ADR 0041/0055): org scope. No `deleted_at` — an invoice
   *  is never soft-deleted (it is superseded, not tombstoned). */
  private scoped(scope: RequestScope) {
    return eq(invoice.organizationId, scope.organizationId);
  }

  async list(scope: RequestScope, params: ListInvoicesParams): Promise<InvoicesPageRows> {
    const ascending = params.sort === "createdAt:asc";
    const rows = await this.txHost.tx
      .select()
      .from(invoice)
      .where(
        and(
          this.scoped(scope),
          params.status ? eq(invoice.status, params.status) : undefined,
          params.cursor
            ? ascending
              ? gt(invoice.id, params.cursor)
              : lt(invoice.id, params.cursor)
            : undefined,
        ),
      )
      .orderBy(ascending ? asc(invoice.id) : desc(invoice.id))
      .limit(params.limit + 1);

    const items = rows.slice(0, params.limit);
    const nextCursor = rows.length > params.limit ? (items.at(-1)?.id ?? null) : null;
    return { items, nextCursor };
  }

  async findById(scope: RequestScope, invoiceId: string): Promise<InvoiceRow | null> {
    const [row] = await this.txHost.tx
      .select()
      .from(invoice)
      .where(and(this.scoped(scope), eq(invoice.id, invoiceId)))
      .limit(1);
    return row ?? null;
  }

  /** System-context lookup for worker event handlers (IDs-only payloads, ADR 0037). */
  async findByIdSystem(invoiceId: string): Promise<InvoiceRow | null> {
    const [row] = await this.txHost.tx
      .select()
      .from(invoice)
      .where(eq(invoice.id, invoiceId))
      .limit(1);
    return row ?? null;
  }

  /** Freeze a new invoice. `ownerId`/`organizationId` are stamped from the scope
   *  (creator/audit + access), never client-supplied. May throw the
   *  `invoice_order_active_uq` unique-violation → 409 at the service. */
  async insert(scope: RequestScope, data: InsertInvoiceData): Promise<InvoiceRow> {
    const [row] = await this.txHost.tx
      .insert(invoice)
      .values({
        ownerId: scope.userId,
        organizationId: scope.organizationId,
        ...data,
      })
      .returning();
    return row!;
  }

  /**
   * Mark an issued invoice paid — CONDITIONAL on `status = 'issued'` so a repeat
   * (already paid) returns no row (→ 409 at the service, idempotent). Payment is
   * row state; the frozen `snapshot` is never touched.
   */
  async markPaid(
    scope: RequestScope,
    invoiceId: string,
    paidAt: Date,
    paidNote: string | null,
  ): Promise<InvoiceRow | null> {
    const [row] = await this.txHost.tx
      .update(invoice)
      .set({ status: "paid", paidAt, paidNote })
      .where(and(this.scoped(scope), eq(invoice.id, invoiceId), eq(invoice.status, "issued")))
      .returning();
    return row ?? null;
  }

  /** Reverse a mark-paid — CONDITIONAL on `status = 'paid'` (idempotent). */
  async unmarkPaid(scope: RequestScope, invoiceId: string): Promise<InvoiceRow | null> {
    const [row] = await this.txHost.tx
      .update(invoice)
      .set({ status: "issued", paidAt: null, paidNote: null })
      .where(and(this.scoped(scope), eq(invoice.id, invoiceId), eq(invoice.status, "paid")))
      .returning();
    return row ?? null;
  }
}
