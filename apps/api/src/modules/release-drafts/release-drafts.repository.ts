/**
 * ReleaseDrafts repository (ADR 0068 Phase 3): drizzle queries through the
 * ambient transactional client (`TransactionHost`, ADR 0037) — inside a
 * `@Transactional()` service method `tx` IS the transaction, outside it falls
 * back to the pooled client (fine for reads and the high-frequency autosave
 * update).
 *
 * EVERY method takes a `RequestScope` and routes its WHERE clause through
 * `scoped()` — the ADR 0055 org seam. There is deliberately no scope-less query
 * surface except `findByIdSystem()` (worker handlers, no request to scope).
 */
import { TransactionHost } from "@nestjs-cls/transactional";
import { type TransactionalAdapterDrizzleOrm } from "@nestjs-cls/transactional-adapter-drizzle-orm";
import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq, gt, isNull, lt } from "drizzle-orm";

import { type Db } from "@repo/db";
import { releaseDraft, type ReleaseDraftRow } from "@repo/db/schema/release-drafts";

import { type RequestScope } from "../../common/tenancy/request-scope.js";

export interface ListReleaseDraftsParams {
  cursor?: string | undefined;
  limit: number;
  sort: "createdAt:asc" | "createdAt:desc";
}

export interface ReleaseDraftsPageRows {
  items: ReleaseDraftRow[];
  /** Id of the last returned row when more exist — UUIDv7 keyset cursor. */
  nextCursor: string | null;
}

/** The mutable, org-scoped fields a create/update may write. */
export interface ReleaseDraftData {
  modelId: string;
  version: number;
  catalogVersion: number | null;
  baseReleaseId: string | null;
  body: unknown;
}

@Injectable()
export class ReleaseDraftsRepository {
  constructor(private readonly txHost: TransactionHost<TransactionalAdapterDrizzleOrm<Db>>) {}

  /** THE access filter (ADR 0055): org scope + live rows. Every method inherits
   *  it; `ownerId` rides on the row as the creator/audit ref, not the boundary. */
  private scoped(scope: RequestScope) {
    return and(
      eq(releaseDraft.organizationId, scope.organizationId),
      isNull(releaseDraft.deletedAt),
    );
  }

  /**
   * Keyset pagination by id (spec §8): UUIDv7 is time-ordered, so `id < cursor`
   * walks creation-time descending (`>` for ascending). `limit + 1` fetch — the
   * extra row only proves a next page exists.
   */
  async list(scope: RequestScope, params: ListReleaseDraftsParams): Promise<ReleaseDraftsPageRows> {
    const ascending = params.sort === "createdAt:asc";
    const rows = await this.txHost.tx
      .select()
      .from(releaseDraft)
      .where(
        and(
          this.scoped(scope),
          params.cursor
            ? ascending
              ? gt(releaseDraft.id, params.cursor)
              : lt(releaseDraft.id, params.cursor)
            : undefined,
        ),
      )
      .orderBy(ascending ? asc(releaseDraft.id) : desc(releaseDraft.id))
      .limit(params.limit + 1);

    const items = rows.slice(0, params.limit);
    const nextCursor = rows.length > params.limit ? (items.at(-1)?.id ?? null) : null;
    return { items, nextCursor };
  }

  async findById(scope: RequestScope, releaseDraftId: string): Promise<ReleaseDraftRow | null> {
    const [row] = await this.txHost.tx
      .select()
      .from(releaseDraft)
      .where(and(this.scoped(scope), eq(releaseDraft.id, releaseDraftId)))
      .limit(1);
    return row ?? null;
  }

  async insert(scope: RequestScope, data: ReleaseDraftData): Promise<ReleaseDraftRow> {
    const [row] = await this.txHost.tx
      .insert(releaseDraft)
      .values({
        // Creator/audit ref (no longer the access scope, ADR 0055).
        ownerId: scope.userId,
        // THE access scope (ADR 0055) — every read filters on it.
        organizationId: scope.organizationId,
        modelId: data.modelId,
        version: data.version,
        catalogVersion: data.catalogVersion,
        baseReleaseId: data.baseReleaseId,
        body: data.body,
      })
      .returning();
    return row!;
  }

  /** Returns the updated row, or null when the scope owns no such live row. */
  async update(
    scope: RequestScope,
    releaseDraftId: string,
    patch: Partial<ReleaseDraftData>,
  ): Promise<ReleaseDraftRow | null> {
    const [row] = await this.txHost.tx
      .update(releaseDraft)
      .set(patch)
      .where(and(this.scoped(scope), eq(releaseDraft.id, releaseDraftId)))
      .returning();
    return row ?? null;
  }

  /** Soft delete (ADR 0032 lifecycle) — true when a live row was tombstoned. */
  async softDelete(scope: RequestScope, releaseDraftId: string): Promise<boolean> {
    const rows = await this.txHost.tx
      .update(releaseDraft)
      .set({ deletedAt: new Date() })
      .where(and(this.scoped(scope), eq(releaseDraft.id, releaseDraftId)))
      .returning({ id: releaseDraft.id });
    return rows.length > 0;
  }
}
