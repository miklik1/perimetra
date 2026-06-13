/**
 * Price-tables repository (ADR 0053) — per-tenant, versioned, append-only price
 * store. Owner-scoped via the ADR-0041 `scoped()` seam (the org retrofit flips
 * this one expression). No update/delete surface: a stamped version is
 * immutable (I3). `resolveActive` is the effective-date lookup the configurator
 * and quote-issue paths resolve a price table through.
 */
import { TransactionHost } from "@nestjs-cls/transactional";
import { type TransactionalAdapterDrizzleOrm } from "@nestjs-cls/transactional-adapter-drizzle-orm";
import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq, gt, isNull, lt, lte, or } from "drizzle-orm";

import { type Db } from "@repo/db";
import { priceTable, type PriceTableRow } from "@repo/db/schema/price-tables";
import { type PriceTableData } from "@repo/validators/price-tables";

import { type RequestScope } from "../../common/tenancy/request-scope.js";

export interface ListPriceTablesParams {
  cursor?: string | undefined;
  limit: number;
  sort: "createdAt:asc" | "createdAt:desc";
}

export interface PriceTablesPageRows {
  items: PriceTableRow[];
  nextCursor: string | null;
}

export interface InsertPriceTableData {
  version: number;
  currency: PriceTableRow["currency"];
  effectiveFrom: Date;
  effectiveTo: Date | null;
  marginFloorPct: string | null;
  dphRate: string;
  reverseCharge: boolean;
  table: PriceTableData;
}

@Injectable()
export class PriceTablesRepository {
  constructor(private readonly txHost: TransactionHost<TransactionalAdapterDrizzleOrm<Db>>) {}

  /** THE ownership filter (ADR 0041) — the org retrofit flips this one line. */
  private scoped(scope: RequestScope) {
    return eq(priceTable.ownerId, scope.userId);
  }

  async list(scope: RequestScope, params: ListPriceTablesParams): Promise<PriceTablesPageRows> {
    const ascending = params.sort === "createdAt:asc";
    const rows = await this.txHost.tx
      .select()
      .from(priceTable)
      .where(
        and(
          this.scoped(scope),
          params.cursor
            ? ascending
              ? gt(priceTable.id, params.cursor)
              : lt(priceTable.id, params.cursor)
            : undefined,
        ),
      )
      .orderBy(ascending ? asc(priceTable.id) : desc(priceTable.id))
      .limit(params.limit + 1);

    const items = rows.slice(0, params.limit);
    const nextCursor = rows.length > params.limit ? (items.at(-1)?.id ?? null) : null;
    return { items, nextCursor };
  }

  async findById(scope: RequestScope, priceTableId: string): Promise<PriceTableRow | null> {
    const [row] = await this.txHost.tx
      .select()
      .from(priceTable)
      .where(and(this.scoped(scope), eq(priceTable.id, priceTableId)))
      .limit(1);
    return row ?? null;
  }

  async findByVersion(scope: RequestScope, version: number): Promise<PriceTableRow | null> {
    const [row] = await this.txHost.tx
      .select()
      .from(priceTable)
      .where(and(this.scoped(scope), eq(priceTable.version, version)))
      .limit(1);
    return row ?? null;
  }

  /** The active table for `asOf`: the most-recently-effective window that
   *  covers the instant (effectiveFrom <= asOf < effectiveTo, or open-ended). */
  async resolveActive(scope: RequestScope, asOf: Date): Promise<PriceTableRow | null> {
    const [row] = await this.txHost.tx
      .select()
      .from(priceTable)
      .where(
        and(
          this.scoped(scope),
          lte(priceTable.effectiveFrom, asOf),
          or(isNull(priceTable.effectiveTo), gt(priceTable.effectiveTo, asOf)),
        ),
      )
      .orderBy(desc(priceTable.effectiveFrom))
      .limit(1);
    return row ?? null;
  }

  async insert(scope: RequestScope, data: InsertPriceTableData): Promise<PriceTableRow> {
    const [row] = await this.txHost.tx
      .insert(priceTable)
      .values({
        ownerId: scope.userId,
        organizationId: scope.organizationId,
        version: data.version,
        currency: data.currency,
        effectiveFrom: data.effectiveFrom,
        effectiveTo: data.effectiveTo,
        marginFloorPct: data.marginFloorPct,
        dphRate: data.dphRate,
        reverseCharge: data.reverseCharge,
        table: data.table,
      })
      .returning();
    return row!;
  }
}
