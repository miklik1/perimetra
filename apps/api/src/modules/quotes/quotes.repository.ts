/**
 * Quotes repository (ADR 0053) — owner-scoped via the ADR-0041 `scoped()` seam
 * (the org retrofit flips this one expression). A quote is append-only once
 * issued (no snapshot update); status transitions land with the lifecycle slice.
 */
import { TransactionHost } from "@nestjs-cls/transactional";
import { type TransactionalAdapterDrizzleOrm } from "@nestjs-cls/transactional-adapter-drizzle-orm";
import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq, gt, lt, sql } from "drizzle-orm";

import { type Db } from "@repo/db";
import {
  quote,
  quoteNumberSequence,
  type QuoteRow,
  type QuoteStatus,
} from "@repo/db/schema/quotes";

import { type RequestScope } from "../../common/tenancy/request-scope.js";

export interface ListQuotesParams {
  cursor?: string | undefined;
  limit: number;
  sort: "createdAt:asc" | "createdAt:desc";
  status?: QuoteStatus | undefined;
}

export interface QuotesPageRows {
  items: QuoteRow[];
  nextCursor: string | null;
}

export type InsertQuoteData = Pick<
  QuoteRow,
  | "projectId"
  | "status"
  | "documentNumber"
  | "currency"
  | "shareToken"
  | "validUntil"
  | "totalMoney"
  | "priceTableVersion"
  | "stamps"
  | "snapshot"
>;

@Injectable()
export class QuotesRepository {
  constructor(private readonly txHost: TransactionHost<TransactionalAdapterDrizzleOrm<Db>>) {}

  /**
   * THE access filter (ADR 0041 seam, activated ADR 0055): org scope. `ownerId`
   * stays on the row as the creator/audit ref but is no longer the boundary.
   */
  private scoped(scope: RequestScope) {
    return eq(quote.organizationId, scope.organizationId);
  }

  async list(scope: RequestScope, params: ListQuotesParams): Promise<QuotesPageRows> {
    const ascending = params.sort === "createdAt:asc";
    const rows = await this.txHost.tx
      .select()
      .from(quote)
      .where(
        and(
          this.scoped(scope),
          params.status ? eq(quote.status, params.status) : undefined,
          params.cursor
            ? ascending
              ? gt(quote.id, params.cursor)
              : lt(quote.id, params.cursor)
            : undefined,
        ),
      )
      .orderBy(ascending ? asc(quote.id) : desc(quote.id))
      .limit(params.limit + 1);

    const items = rows.slice(0, params.limit);
    const nextCursor = rows.length > params.limit ? (items.at(-1)?.id ?? null) : null;
    return { items, nextCursor };
  }

  async findById(scope: RequestScope, quoteId: string): Promise<QuoteRow | null> {
    const [row] = await this.txHost.tx
      .select()
      .from(quote)
      .where(and(this.scoped(scope), eq(quote.id, quoteId)))
      .limit(1);
    return row ?? null;
  }

  /**
   * Allocate the next gap-free document number for the org's `year` series
   * (ADR 0079). One atomic upsert: insert the counter at 1 on first use, else
   * increment and RETURNING the new value. Called INSIDE the issue `@Transactional()`
   * — so a rolled-back issue rolls back the increment (no gap), and concurrent
   * issues serialize on the (org, year) row lock (no duplicate). Returns the
   * raw sequence value; `formatQuoteNumber` renders the human/legal string.
   */
  async allocateNumber(scope: RequestScope, year: number): Promise<number> {
    const [row] = await this.txHost.tx
      .insert(quoteNumberSequence)
      .values({ organizationId: scope.organizationId, year, lastNumber: 1 })
      .onConflictDoUpdate({
        target: [quoteNumberSequence.organizationId, quoteNumberSequence.year],
        set: {
          lastNumber: sql`${quoteNumberSequence.lastNumber} + 1`,
          updatedAt: sql`now()`,
        },
      })
      .returning({ lastNumber: quoteNumberSequence.lastNumber });
    return row!.lastNumber;
  }

  async insert(scope: RequestScope, data: InsertQuoteData): Promise<QuoteRow> {
    const [row] = await this.txHost.tx
      .insert(quote)
      .values({
        ownerId: scope.userId,
        organizationId: scope.organizationId,
        ...data,
      })
      .returning();
    return row!;
  }
}
