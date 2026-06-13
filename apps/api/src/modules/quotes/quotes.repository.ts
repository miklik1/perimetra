/**
 * Quotes repository (ADR 0053) — owner-scoped via the ADR-0041 `scoped()` seam
 * (the org retrofit flips this one expression). A quote is append-only once
 * issued (no snapshot update); status transitions land with the lifecycle slice.
 */
import { TransactionHost } from "@nestjs-cls/transactional";
import { type TransactionalAdapterDrizzleOrm } from "@nestjs-cls/transactional-adapter-drizzle-orm";
import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq, gt, lt } from "drizzle-orm";

import { type Db } from "@repo/db";
import { quote, type QuoteRow, type QuoteStatus } from "@repo/db/schema/quotes";

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
  | "currency"
  | "shareToken"
  | "validUntil"
  | "totalMoney"
  | "catalogVersion"
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
