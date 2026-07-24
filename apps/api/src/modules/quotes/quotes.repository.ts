/**
 * Quotes repository (ADR 0053) — owner-scoped via the ADR-0041 `scoped()` seam
 * (the org retrofit flips this one expression). A quote is append-only once
 * issued (no snapshot update); status transitions land with the lifecycle slice.
 */
import { TransactionHost } from "@nestjs-cls/transactional";
import { type TransactionalAdapterDrizzleOrm } from "@nestjs-cls/transactional-adapter-drizzle-orm";
import { Injectable } from "@nestjs/common";
import { and, asc, count, desc, eq, gt, inArray, isNull, lt, lte } from "drizzle-orm";

import { type Db } from "@repo/db";
import { quote, type QuoteRow, type QuoteStatus } from "@repo/db/schema/quotes";

import { type RequestScope } from "../../common/tenancy/request-scope.js";

/** The "open work" statuses the nav pill counts (1c-3): a quote still in play.
 *  `expired` is a DERIVED read of a lapsed `issued` quote (never stored), so a
 *  lapsed quote stays counted here — it is still actionable/reviseable. */
const OPEN_QUOTE_STATUSES = ["draft", "issued"] as const satisfies readonly QuoteStatus[];

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

/** A recent-activity projection (dashboard summary, ADR 0125) — the fields the
 *  "Přehled" activity feed needs; `validUntil` rides along so the service can
 *  resolve the effective status (`expired` is derived, never stored, ADR 0083).
 *  No money — activity carries none. */
export interface RecentQuoteRow {
  id: string;
  documentNumber: string;
  status: QuoteStatus;
  validUntil: Date | null;
  updatedAt: Date;
}

/** An expiring-quotes-widget projection (dashboard summary, ADR 0125). Carries
 *  the denormalized `totalMoney` (I10) — the service ships this ONLY to a
 *  non-price-blind caller, so the money never reaches the workshop. */
export interface ExpiringQuoteRow {
  id: string;
  documentNumber: string;
  status: QuoteStatus;
  validUntil: Date | null;
  totalMoney: string;
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

  /**
   * Count the open quotes (`draft` + `issued`) the caller may see — the nav
   * pill source (1c-3). Runs through the SAME `scoped()` filter as `list`, so a
   * `sales` rep's count is narrowed to their own rows exactly as their list is;
   * admin/workshop count the whole org. A pure aggregate — no rows shipped.
   */
  async countOpen(scope: RequestScope, opts: QuoteScopeOpts): Promise<number> {
    const [row] = await this.txHost.tx
      .select({ value: count() })
      .from(quote)
      .where(and(this.scoped(scope, opts), inArray(quote.status, OPEN_QUOTE_STATUSES)));
    return row?.value ?? 0;
  }

  /**
   * Count the caller's quotes in any of the given statuses (dashboard summary,
   * ADR 0125) — the ONE generic count-by-status the dashboard KPIs share
   * (`accepted` today). Runs through the SAME `scoped()` filter as `list`, so a
   * `sales` rep's count is owner-narrowed exactly as their list. A pure
   * aggregate — no rows shipped. Empty status set ⇒ 0 (never an unfiltered count).
   */
  async countByStatuses(
    scope: RequestScope,
    opts: QuoteScopeOpts,
    statuses: readonly QuoteStatus[],
  ): Promise<number> {
    if (statuses.length === 0) return 0;
    const [row] = await this.txHost.tx
      .select({ value: count() })
      .from(quote)
      .where(and(this.scoped(scope, opts), inArray(quote.status, statuses)));
    return row?.value ?? 0;
  }

  /**
   * Count the caller's `issued` quotes whose `validUntil` falls in `(from, to]`
   * — the "expiring soon" KPI (dashboard summary, ADR 0125). `gt(from)` excludes
   * an already-lapsed quote (an `issued` quote past `validUntil` reads as
   * `expired`, ADR 0083 — it is not "expiring soon", it has lapsed); `lte(to)`
   * bounds the near horizon. Owner-narrowed for sales via `scoped()`.
   */
  async countExpiringWithin(
    scope: RequestScope,
    opts: QuoteScopeOpts,
    from: Date,
    to: Date,
  ): Promise<number> {
    const [row] = await this.txHost.tx
      .select({ value: count() })
      .from(quote)
      .where(
        and(
          this.scoped(scope, opts),
          eq(quote.status, "issued"),
          gt(quote.validUntil, from),
          lte(quote.validUntil, to),
        ),
      );
    return row?.value ?? 0;
  }

  /** Top-N most-recently-touched quotes (dashboard activity feed, ADR 0125) —
   *  owner-narrowed for sales via `scoped()`. A fixed-N read, not paginated;
   *  `id` is the deterministic tiebreaker on equal `updatedAt`. */
  async listRecent(
    scope: RequestScope,
    opts: QuoteScopeOpts,
    limit: number,
  ): Promise<RecentQuoteRow[]> {
    return this.txHost.tx
      .select({
        id: quote.id,
        documentNumber: quote.documentNumber,
        status: quote.status,
        validUntil: quote.validUntil,
        updatedAt: quote.updatedAt,
      })
      .from(quote)
      .where(this.scoped(scope, opts))
      .orderBy(desc(quote.updatedAt), desc(quote.id))
      .limit(limit);
  }

  /** The soonest-to-lapse `issued` quotes with a still-future `validUntil`
   *  (dashboard expiring-quotes widget, ADR 0125) — `validUntil` ASC, top-N.
   *  `gt(now)` excludes already-lapsed (effectively `expired`) quotes and null
   *  `validUntil` (an open-ended quote is not expiring). Owner-narrowed for sales. */
  async listExpiring(
    scope: RequestScope,
    opts: QuoteScopeOpts,
    now: Date,
    limit: number,
  ): Promise<ExpiringQuoteRow[]> {
    return this.txHost.tx
      .select({
        id: quote.id,
        documentNumber: quote.documentNumber,
        status: quote.status,
        validUntil: quote.validUntil,
        totalMoney: quote.totalMoney,
      })
      .from(quote)
      .where(and(this.scoped(scope, opts), eq(quote.status, "issued"), gt(quote.validUntil, now)))
      .orderBy(asc(quote.validUntil), asc(quote.id))
      .limit(limit);
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
