/**
 * Releases repository (ADR 0053) — the immutable vendor release store. The store
 * itself is GLOBAL vendor data: `list`/`findById`/`findByReleaseId`/`insert`
 * carry NO scope (a published release is immutable forever and re-derives for
 * ANY org via the natural key — I3). Tenant VISIBILITY (ADR 0062) is a separate
 * layer: the `org_release_assignment` join records which releases an org may
 * SEE, and `listAssignedTo`/`isAssigned`/`findAssignedReleaseIds` filter through
 * it. `assign`/`unassign` are the platform operator's writes to that join.
 * Crucially, the GLOBAL lookups stay unscoped — visibility gates discovery, NOT
 * re-derivation (a quote on a since-unassigned release still reproduces).
 */
import { TransactionHost } from "@nestjs-cls/transactional";
import { type TransactionalAdapterDrizzleOrm } from "@nestjs-cls/transactional-adapter-drizzle-orm";
import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq, getTableColumns, gt, lt } from "drizzle-orm";

import { type Db } from "@repo/db";
import {
  orgModelPin,
  orgReleaseAssignment,
  release,
  type ReleaseRow,
  type ReleaseStatus,
} from "@repo/db/schema/releases";
import { type ProductModelRelease } from "@repo/model";

/** One release an org is assigned, with the version-grouping metadata the
 *  pin/upgrade logic needs (ADR 0064). */
export interface AssignedReleaseMeta {
  releaseId: string;
  modelId: string;
  version: number;
  catalogVersion: number;
}

/** An org's active version pin for one model (ADR 0064). */
export interface ModelPin {
  modelId: string;
  pinnedReleaseId: string;
}

/** An org's active pin for one model, with the pinned release's catalog version
 *  — a single consistent read for the opt-in catalog pre-flight (ADR 0064). */
export interface PinnedReleaseCatalog {
  modelId: string;
  pinnedReleaseId: string;
  catalogVersion: number;
}

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

  /**
   * Tenant-facing list (ADR 0062): only releases ASSIGNED to `organizationId`,
   * keyset-paginated by id like {@link list}. The inner join to
   * `org_release_assignment` is the single place the per-tenant visibility
   * filter lives — the analogue of `scoped()` for this otherwise-global store.
   */
  async listAssignedTo(
    organizationId: string,
    params: ListReleasesParams,
  ): Promise<ReleasesPageRows> {
    const ascending = params.sort === "createdAt:asc";
    const rows = await this.txHost.tx
      .select(getTableColumns(release))
      .from(release)
      .innerJoin(
        orgReleaseAssignment,
        and(
          eq(orgReleaseAssignment.releaseId, release.releaseId),
          eq(orgReleaseAssignment.organizationId, organizationId),
        ),
      )
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

  /**
   * Tenant CONFIGURATOR list (ADR 0064): only the PINNED version per model the
   * org is assigned — assignment ∧ pin. The newer "upgrade available" versions
   * an org may also be assigned are deliberately excluded here (they surface as
   * opt-in offers, not as parallel picker entries — CORE_SPEC §3). The pin join
   * is on the natural key, so a pin always co-resolves with its assignment row.
   */
  async listPinnedAssignedTo(
    organizationId: string,
    params: ListReleasesParams,
  ): Promise<ReleasesPageRows> {
    const ascending = params.sort === "createdAt:asc";
    const rows = await this.txHost.tx
      .select(getTableColumns(release))
      .from(release)
      .innerJoin(
        orgReleaseAssignment,
        and(
          eq(orgReleaseAssignment.releaseId, release.releaseId),
          eq(orgReleaseAssignment.organizationId, organizationId),
        ),
      )
      .innerJoin(
        orgModelPin,
        and(
          eq(orgModelPin.pinnedReleaseId, release.releaseId),
          eq(orgModelPin.organizationId, organizationId),
        ),
      )
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

  /** Whether `releaseId` is assigned to `organizationId` (quote-issue gate). */
  async isAssigned(organizationId: string, releaseId: string): Promise<boolean> {
    const [row] = await this.txHost.tx
      .select({ id: orgReleaseAssignment.id })
      .from(orgReleaseAssignment)
      .where(
        and(
          eq(orgReleaseAssignment.organizationId, organizationId),
          eq(orgReleaseAssignment.releaseId, releaseId),
        ),
      )
      .limit(1);
    return row !== undefined;
  }

  /** The natural release keys an org is assigned (the platform console view). */
  async findAssignedReleaseIds(organizationId: string): Promise<string[]> {
    const rows = await this.txHost.tx
      .select({ releaseId: orgReleaseAssignment.releaseId })
      .from(orgReleaseAssignment)
      .where(eq(orgReleaseAssignment.organizationId, organizationId))
      .orderBy(asc(orgReleaseAssignment.releaseId));
    return rows.map((r) => r.releaseId);
  }

  /** Assign a release to an org (platform write). Idempotent — re-assigning the
   *  same (org, release) is a no-op via the unique index. Returns whether a row
   *  was actually inserted (false on a conflict) so the service only audits a
   *  real state change. */
  async assign(organizationId: string, releaseId: string, assignedBy: string): Promise<boolean> {
    const inserted = await this.txHost.tx
      .insert(orgReleaseAssignment)
      .values({ organizationId, releaseId, assignedBy })
      .onConflictDoNothing({
        target: [orgReleaseAssignment.organizationId, orgReleaseAssignment.releaseId],
      })
      .returning({ id: orgReleaseAssignment.id });
    return inserted.length > 0;
  }

  /** Remove an assignment (platform write). Returns how many rows were deleted
   *  (0 when the org was not assigned the release). */
  async unassign(organizationId: string, releaseId: string): Promise<number> {
    const deleted = await this.txHost.tx
      .delete(orgReleaseAssignment)
      .where(
        and(
          eq(orgReleaseAssignment.organizationId, organizationId),
          eq(orgReleaseAssignment.releaseId, releaseId),
        ),
      )
      .returning({ id: orgReleaseAssignment.id });
    return deleted.length;
  }

  // --- Version pins (ADR 0064) -----------------------------------------------

  /** Every release an org is assigned, decorated with the version-grouping
   *  metadata the pin/upgrade logic needs (model family, version, catalog). */
  async findAssignedReleasesWithMeta(organizationId: string): Promise<AssignedReleaseMeta[]> {
    return this.txHost.tx
      .select({
        releaseId: release.releaseId,
        modelId: release.modelId,
        version: release.version,
        catalogVersion: release.catalogVersion,
      })
      .from(release)
      .innerJoin(
        orgReleaseAssignment,
        and(
          eq(orgReleaseAssignment.releaseId, release.releaseId),
          eq(orgReleaseAssignment.organizationId, organizationId),
        ),
      );
  }

  /** An org's active pins (one per model it uses). */
  async findPins(organizationId: string): Promise<ModelPin[]> {
    return this.txHost.tx
      .select({ modelId: orgModelPin.modelId, pinnedReleaseId: orgModelPin.pinnedReleaseId })
      .from(orgModelPin)
      .where(eq(orgModelPin.organizationId, organizationId))
      .orderBy(asc(orgModelPin.modelId));
  }

  /** An org's active pins joined to each pinned release's catalog version — ONE
   *  statement, so the opt-in pre-flight reads a single consistent snapshot of
   *  pins + their catalogs (no TOCTOU vs. a concurrent assign). */
  async findPinnedReleaseCatalogs(organizationId: string): Promise<PinnedReleaseCatalog[]> {
    return this.txHost.tx
      .select({
        modelId: orgModelPin.modelId,
        pinnedReleaseId: orgModelPin.pinnedReleaseId,
        catalogVersion: release.catalogVersion,
      })
      .from(orgModelPin)
      .innerJoin(release, eq(release.releaseId, orgModelPin.pinnedReleaseId))
      .where(eq(orgModelPin.organizationId, organizationId));
  }

  /** Create the active pin for a model IF the org has none yet (lazy default on
   *  first assign). ON CONFLICT keeps an existing pin — a newer version never
   *  silently moves it (CORE_SPEC §3). Returns whether a pin was created. */
  async ensurePin(
    organizationId: string,
    modelId: string,
    releaseId: string,
    pinnedBy: string,
  ): Promise<boolean> {
    const inserted = await this.txHost.tx
      .insert(orgModelPin)
      .values({ organizationId, modelId, pinnedReleaseId: releaseId, pinnedBy })
      .onConflictDoNothing({ target: [orgModelPin.organizationId, orgModelPin.modelId] })
      .returning({ id: orgModelPin.id });
    return inserted.length > 0;
  }

  /** Move the active pin for a model to `releaseId` (the explicit opt-in). Upsert
   *  so a first-ever pin is also handled; `updatedAt` is bumped via `$onUpdate`. */
  async movePin(
    organizationId: string,
    modelId: string,
    releaseId: string,
    pinnedBy: string,
  ): Promise<void> {
    await this.txHost.tx
      .insert(orgModelPin)
      .values({ organizationId, modelId, pinnedReleaseId: releaseId, pinnedBy })
      .onConflictDoUpdate({
        target: [orgModelPin.organizationId, orgModelPin.modelId],
        set: { pinnedReleaseId: releaseId, pinnedBy, updatedAt: new Date() },
      });
  }

  /** Drop any pin pointing at `releaseId` (pin hygiene when its assignment is
   *  removed — a pin must never point at an unassigned release). Returns rows
   *  deleted. */
  async deletePinByReleaseId(organizationId: string, releaseId: string): Promise<number> {
    const deleted = await this.txHost.tx
      .delete(orgModelPin)
      .where(
        and(
          eq(orgModelPin.organizationId, organizationId),
          eq(orgModelPin.pinnedReleaseId, releaseId),
        ),
      )
      .returning({ id: orgModelPin.id });
    return deleted.length;
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
