/**
 * Catalog-versions repository (ADR 0053) — the immutable vendor catalog store.
 * Unlike the reference repository (`modules/projects`) there is NO RequestScope
 * and NO `scoped()` filter: catalog versions are GLOBAL vendor data, not
 * owner/tenant-owned. The store is append-only — there is no update or delete
 * surface (a published `catalog@N` is immutable forever, I3).
 */
import { TransactionHost } from "@nestjs-cls/transactional";
import { type TransactionalAdapterDrizzleOrm } from "@nestjs-cls/transactional-adapter-drizzle-orm";
import { Injectable } from "@nestjs/common";
import { asc, desc, eq, gt, lt } from "drizzle-orm";

import { type Db } from "@repo/db";
import { catalogVersion, type CatalogVersionRow } from "@repo/db/schema/catalog-versions";
import { type Catalog } from "@repo/model";

export interface ListCatalogVersionsParams {
  cursor?: string | undefined;
  limit: number;
  sort: "createdAt:asc" | "createdAt:desc";
}

export interface CatalogVersionsPageRows {
  items: CatalogVersionRow[];
  /** Id of the last returned row when more exist — UUIDv7 keyset cursor. */
  nextCursor: string | null;
}

@Injectable()
export class CatalogVersionsRepository {
  constructor(private readonly txHost: TransactionHost<TransactionalAdapterDrizzleOrm<Db>>) {}

  /** Keyset pagination by id (spec §8); global — no scope filter (vendor data). */
  async list(params: ListCatalogVersionsParams): Promise<CatalogVersionsPageRows> {
    const ascending = params.sort === "createdAt:asc";
    const rows = await this.txHost.tx
      .select()
      .from(catalogVersion)
      .where(
        params.cursor
          ? ascending
            ? gt(catalogVersion.id, params.cursor)
            : lt(catalogVersion.id, params.cursor)
          : undefined,
      )
      .orderBy(ascending ? asc(catalogVersion.id) : desc(catalogVersion.id))
      .limit(params.limit + 1);

    const items = rows.slice(0, params.limit);
    const nextCursor = rows.length > params.limit ? (items.at(-1)?.id ?? null) : null;
    return { items, nextCursor };
  }

  async findById(catalogVersionId: string): Promise<CatalogVersionRow | null> {
    const [row] = await this.txHost.tx
      .select()
      .from(catalogVersion)
      .where(eq(catalogVersion.id, catalogVersionId))
      .limit(1);
    return row ?? null;
  }

  async findByVersion(version: number): Promise<CatalogVersionRow | null> {
    const [row] = await this.txHost.tx
      .select()
      .from(catalogVersion)
      .where(eq(catalogVersion.version, version))
      .limit(1);
    return row ?? null;
  }

  /** Append a new immutable catalog version. */
  async insert(data: { version: number; body: Catalog }): Promise<CatalogVersionRow> {
    const [row] = await this.txHost.tx
      .insert(catalogVersion)
      .values({ version: data.version, body: data.body })
      .returning();
    return row!;
  }
}
