/**
 * Deviation-ledger repository (ADR 0110 / ADR-O4, CAR-159) — writes are always
 * org-stamped from the scope; reads route through the org filter. The ledger is
 * append-only in normal operation (a projection); `deleteQuoteOverrides` exists
 * only for the rebuild path (re-project the snapshot-derivable rows).
 */
import { TransactionHost } from "@nestjs-cls/transactional";
import { type TransactionalAdapterDrizzleOrm } from "@nestjs-cls/transactional-adapter-drizzle-orm";
import { Injectable } from "@nestjs/common";
import { and, desc, eq, gte, lt } from "drizzle-orm";

import { type Db } from "@repo/db";
import {
  deviationLedger,
  type DeviationLedgerRow,
  type DeviationSource,
} from "@repo/db/schema/ledger";

import { type RequestScope } from "../../common/tenancy/request-scope.js";

/** A ledger row as a source act hands it over — the org is stamped from scope. */
export interface LedgerRowInput {
  quoteId: string;
  orderId?: string | null;
  source: DeviationSource;
  kind?: string | null;
  target?: string | null;
  value?: unknown;
  reason?: string;
  actorId?: string | null;
}

export interface ListLedgerParams {
  cursor?: string | undefined;
  limit: number;
  target?: string | undefined;
  from?: string | undefined;
  quoteId?: string | undefined;
}

@Injectable()
export class LedgerRepository {
  constructor(private readonly txHost: TransactionHost<TransactionalAdapterDrizzleOrm<Db>>) {}

  private scoped(scope: RequestScope) {
    return eq(deviationLedger.organizationId, scope.organizationId);
  }

  async insertMany(scope: RequestScope, rows: LedgerRowInput[]): Promise<void> {
    if (rows.length === 0) return;
    await this.txHost.tx.insert(deviationLedger).values(
      rows.map((r) => ({
        organizationId: scope.organizationId,
        quoteId: r.quoteId,
        orderId: r.orderId ?? null,
        source: r.source,
        kind: r.kind ?? null,
        target: r.target ?? null,
        value: r.value ?? null,
        reason: r.reason ?? "",
        actorId: r.actorId ?? null,
      })),
    );
  }

  /** Keyset page (desc by id — newest first) with the optional filters. */
  async list(scope: RequestScope, params: ListLedgerParams): Promise<DeviationLedgerRow[]> {
    return this.txHost.tx
      .select()
      .from(deviationLedger)
      .where(
        and(
          this.scoped(scope),
          params.quoteId ? eq(deviationLedger.quoteId, params.quoteId) : undefined,
          params.target ? eq(deviationLedger.target, params.target) : undefined,
          params.from ? gte(deviationLedger.createdAt, new Date(params.from)) : undefined,
          params.cursor ? lt(deviationLedger.id, params.cursor) : undefined,
        ),
      )
      .orderBy(desc(deviationLedger.id))
      .limit(params.limit + 1);
  }

  /** Every `quote_override` row (the recurrence report's input), optional target. */
  async findQuoteOverrides(scope: RequestScope, target?: string): Promise<DeviationLedgerRow[]> {
    return this.txHost.tx
      .select()
      .from(deviationLedger)
      .where(
        and(
          this.scoped(scope),
          eq(deviationLedger.source, "quote_override"),
          target ? eq(deviationLedger.target, target) : undefined,
        ),
      );
  }

  /** Rebuild support — drop the snapshot-derivable rows before re-projecting.
   *  Leaves `margin_override`/`order_exception` (authoritative direct writes). */
  async deleteQuoteOverrides(scope: RequestScope): Promise<void> {
    await this.txHost.tx
      .delete(deviationLedger)
      .where(and(this.scoped(scope), eq(deviationLedger.source, "quote_override")));
  }
}
