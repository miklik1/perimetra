/**
 * Quotes repository (ADR 0053) — owner-scoped via the ADR-0041 `scoped()` seam
 * (the org retrofit flips this one expression). A quote is append-only once
 * issued (no snapshot update); status transitions land with the lifecycle slice.
 */
import { TransactionHost } from "@nestjs-cls/transactional";
import { type TransactionalAdapterDrizzleOrm } from "@nestjs-cls/transactional-adapter-drizzle-orm";
import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq, gt, isNull, lt, sql } from "drizzle-orm";

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
  | "customerId"
  | "status"
  | "documentNumber"
  | "currency"
  | "shareToken"
  | "validUntil"
  | "totalMoney"
  | "priceTableVersion"
  | "stamps"
  | "snapshot"
  | "revisionOfId"
>;

/** Per-rep ownership narrowing (ADR 0082) — layered ON TOP of the org scope,
 *  never replacing it. admin sees the whole org; a rep is narrowed to own rows. */
export interface QuoteScopeOpts {
  restrictToOwner: boolean;
}

@Injectable()
export class QuotesRepository {
  constructor(private readonly txHost: TransactionHost<TransactionalAdapterDrizzleOrm<Db>>) {}

  /**
   * THE access filter (ADR 0041 seam, activated ADR 0055): org scope, plus the
   * per-rep ownership narrowing (ADR 0082) layered on top — a rep sees only its
   * own quotes (`ownerId`), admin the whole org. `ownerId` is the creator/audit
   * ref; the org filter is never dropped.
   */
  private scoped(scope: RequestScope, opts: QuoteScopeOpts) {
    return and(
      eq(quote.organizationId, scope.organizationId),
      opts.restrictToOwner ? eq(quote.ownerId, scope.userId) : undefined,
    );
  }

  async list(
    scope: RequestScope,
    opts: QuoteScopeOpts,
    params: ListQuotesParams,
  ): Promise<QuotesPageRows> {
    const ascending = params.sort === "createdAt:asc";
    const rows = await this.txHost.tx
      .select()
      .from(quote)
      .where(
        and(
          this.scoped(scope, opts),
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

  async findById(
    scope: RequestScope,
    opts: QuoteScopeOpts,
    quoteId: string,
  ): Promise<QuoteRow | null> {
    const [row] = await this.txHost.tx
      .select()
      .from(quote)
      .where(and(this.scoped(scope, opts), eq(quote.id, quoteId)))
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

  /**
   * Resolve a quote by its `shareToken` — the buyer's bearer credential (ADR
   * 0083). Deliberately SCOPE-LESS: the buyer has no session/org; the unguessable
   * token IS the authorization. The unique index makes it a single-row lookup.
   */
  async findByShareToken(shareToken: string): Promise<QuoteRow | null> {
    const [row] = await this.txHost.tx
      .select()
      .from(quote)
      .where(eq(quote.shareToken, shareToken))
      .limit(1);
    return row ?? null;
  }

  /** All (id, snapshot) pairs for the org — the deviation-ledger rebuild
   *  re-projects the snapshot-derivable rows (ADR-O4). Org-scoped read. */
  async findAllWithSnapshot(scope: RequestScope): Promise<{ id: string; snapshot: unknown }[]> {
    return this.txHost.tx
      .select({ id: quote.id, snapshot: quote.snapshot })
      .from(quote)
      .where(eq(quote.organizationId, scope.organizationId));
  }

  /** Move the status field (the only mutable field on an issued quote — the I3
   *  snapshot is never touched). Scope-less: the caller has already authorized
   *  (buyer via shareToken, or a scoped service read). */
  async setStatus(quoteId: string, status: QuoteStatus): Promise<void> {
    await this.txHost.tx
      .update(quote)
      .set({ status, updatedAt: new Date() })
      .where(eq(quote.id, quoteId));
  }

  /** Supersede a quote (ADR 0109 / ADR-O1, CAR-158) — CONDITIONAL on it not being
   *  already superseded (`superseded_by_id IS NULL`). The row lock + this predicate
   *  make revise-vs-revise race-safe: exactly one update takes; the loser gets 0
   *  rows. Org-scoped defense-in-depth (the caller already loaded it scoped).
   *  Returns true when this call was the one that superseded the quote. */
  async setSupersededBy(
    scope: RequestScope,
    quoteId: string,
    supersededById: string,
  ): Promise<boolean> {
    const rows = await this.txHost.tx
      .update(quote)
      .set({ supersededById, updatedAt: new Date() })
      .where(
        and(
          eq(quote.organizationId, scope.organizationId),
          eq(quote.id, quoteId),
          isNull(quote.supersededById),
        ),
      )
      .returning({ id: quote.id });
    return rows.length > 0;
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
