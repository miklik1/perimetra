/**
 * Releases repository (ADR 0053) — the immutable vendor release store. Like the
 * catalog-versions repository (and unlike `modules/projects`) there is NO
 * RequestScope and NO `scoped()` filter: releases are GLOBAL vendor data. The
 * store is append-only — no update or delete surface (a published release is
 * immutable forever, I3).
 */
import { TransactionHost } from "@nestjs-cls/transactional";
import { type TransactionalAdapterDrizzleOrm } from "@nestjs-cls/transactional-adapter-drizzle-orm";
import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq, gt, lt } from "drizzle-orm";

import { type Db } from "@repo/db";
import { release, type ReleaseRow, type ReleaseStatus } from "@repo/db/schema/releases";
import { type ProductModelRelease } from "@repo/model";

export interface ListReleasesParams {
  cursor?: string | undefined;
  limit: number;
  sort: "createdAt:asc" | "createdAt:desc";
  status?: ReleaseStatus | undefined;
}

export interface ReleasesPageRows {
  items: ReleaseRow[];
  /** Id of the last returned row when more exist — UUIDv7 keyset cursor. */
  nextCursor: string | null;
}

export interface InsertReleaseData {
  releaseId: string;
  modelId: string;
  version: number;
  catalogVersion: number;
  status: ReleaseStatus;
  body: ProductModelRelease;
  /** The configurator's starting config (publish metadata, gated server-side). */
  initialInput?: Record<string, unknown> | null;
}

@Injectable()
export class ReleasesRepository {
  constructor(private readonly txHost: TransactionHost<TransactionalAdapterDrizzleOrm<Db>>) {}

  /** Keyset pagination by id (spec §8); global — no scope filter (vendor data). */
  async list(params: ListReleasesParams): Promise<ReleasesPageRows> {
    const ascending = params.sort === "createdAt:asc";
    const rows = await this.txHost.tx
      .select()
      .from(release)
      .where(
        and(
          params.status ? eq(release.status, params.status) : undefined,
          params.cursor
            ? ascending
              ? gt(release.id, params.cursor)
              : lt(release.id, params.cursor)
            : undefined,
        ),
      )
      .orderBy(ascending ? asc(release.id) : desc(release.id))
      .limit(params.limit + 1);

    const items = rows.slice(0, params.limit);
    const nextCursor = rows.length > params.limit ? (items.at(-1)?.id ?? null) : null;
    return { items, nextCursor };
  }

  async findById(releaseRowId: string): Promise<ReleaseRow | null> {
    const [row] = await this.txHost.tx
      .select()
      .from(release)
      .where(eq(release.id, releaseRowId))
      .limit(1);
    return row ?? null;
  }

  /** Lookup by the natural key (`ProductModelRelease.id` "modelId@version") —
   *  the handle quote stamps record, the I3 re-derivation entry point. */
  async findByReleaseId(releaseId: string): Promise<ReleaseRow | null> {
    const [row] = await this.txHost.tx
      .select()
      .from(release)
      .where(eq(release.releaseId, releaseId))
      .limit(1);
    return row ?? null;
  }

  /** Append a new immutable release. */
  async insert(data: InsertReleaseData): Promise<ReleaseRow> {
    const [row] = await this.txHost.tx
      .insert(release)
      .values({
        releaseId: data.releaseId,
        modelId: data.modelId,
        version: data.version,
        catalogVersion: data.catalogVersion,
        status: data.status,
        body: data.body,
        initialInput: data.initialInput ?? null,
      })
      .returning();
    return row!;
  }
}
