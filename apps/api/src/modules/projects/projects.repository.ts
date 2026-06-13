/**
 * Reference repository (spec §7.8): drizzle queries through the ambient
 * transactional client (`TransactionHost`, ADR 0037) — inside a
 * `@Transactional()` service method `tx` IS the transaction, outside it
 * falls back to the pooled client (fine for the read-only paths).
 *
 * EVERY method takes a `RequestScope` and routes its WHERE clause through
 * `scoped()` — the ADR 0041 seam. There is deliberately no scope-less query
 * surface except `findByIdSystem()` (worker handlers, no request to scope).
 */
import { TransactionHost } from "@nestjs-cls/transactional";
import { type TransactionalAdapterDrizzleOrm } from "@nestjs-cls/transactional-adapter-drizzle-orm";
import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq, gt, isNull, lt } from "drizzle-orm";

import { type Db } from "@repo/db";
import {
  project,
  projectInstance,
  type NewProjectInstanceRow,
  type ProjectInstanceRow,
  type ProjectRow,
  type ProjectStatus,
} from "@repo/db/schema/projects";

import { type RequestScope } from "../../common/tenancy/request-scope.js";

export interface ListProjectsParams {
  cursor?: string | undefined;
  limit: number;
  sort: "createdAt:asc" | "createdAt:desc";
  status?: ProjectStatus | undefined;
}

export interface ProjectsPageRows {
  items: ProjectRow[];
  /** Id of the last returned row when more exist — UUIDv7 keyset cursor. */
  nextCursor: string | null;
}

@Injectable()
export class ProjectsRepository {
  constructor(private readonly txHost: TransactionHost<TransactionalAdapterDrizzleOrm<Db>>) {}

  /**
   * THE access filter (ADR 0041 seam, activated ADR 0055): org scope + live
   * rows. Every method below inherits it; `ownerId` is retained on the row as
   * the creator/audit ref but is no longer the access boundary.
   */
  private scoped(scope: RequestScope) {
    return and(eq(project.organizationId, scope.organizationId), isNull(project.deletedAt));
  }

  /**
   * Keyset pagination by id (spec §8): UUIDv7 is time-ordered, so `id <
   * cursor` walks creation-time descending (`>` for ascending). `limit + 1`
   * fetch — the extra row only proves a next page exists.
   */
  async list(scope: RequestScope, params: ListProjectsParams): Promise<ProjectsPageRows> {
    const ascending = params.sort === "createdAt:asc";
    const rows = await this.txHost.tx
      .select()
      .from(project)
      .where(
        and(
          this.scoped(scope),
          params.status ? eq(project.status, params.status) : undefined,
          params.cursor
            ? ascending
              ? gt(project.id, params.cursor)
              : lt(project.id, params.cursor)
            : undefined,
        ),
      )
      .orderBy(ascending ? asc(project.id) : desc(project.id))
      .limit(params.limit + 1);

    const items = rows.slice(0, params.limit);
    const nextCursor = rows.length > params.limit ? (items.at(-1)?.id ?? null) : null;
    return { items, nextCursor };
  }

  async findById(scope: RequestScope, projectId: string): Promise<ProjectRow | null> {
    const [row] = await this.txHost.tx
      .select()
      .from(project)
      .where(and(this.scoped(scope), eq(project.id, projectId)))
      .limit(1);
    return row ?? null;
  }

  /**
   * System-context lookup for worker event handlers, which re-fetch from
   * IDs-only payloads (ADR 0037) and have no request scope to apply. Still
   * excludes soft-deleted rows. NOT for controllers — request-driven code
   * goes through `findById(scope, …)`.
   */
  async findByIdSystem(projectId: string): Promise<ProjectRow | null> {
    const [row] = await this.txHost.tx
      .select()
      .from(project)
      .where(and(eq(project.id, projectId), isNull(project.deletedAt)))
      .limit(1);
    return row ?? null;
  }

  async insert(
    scope: RequestScope,
    data: { name: string; description?: string | undefined },
  ): Promise<ProjectRow> {
    const [row] = await this.txHost.tx
      .insert(project)
      .values({
        // Creator/audit ref (no longer the access scope, ADR 0055).
        ownerId: scope.userId,
        // THE access scope (ADR 0055) — every read filters on it.
        organizationId: scope.organizationId,
        name: data.name,
        description: data.description ?? null,
      })
      .returning();
    return row!;
  }

  /** Returns the updated row, or null when the scope owns no such live row. */
  async update(
    scope: RequestScope,
    projectId: string,
    patch: Partial<Pick<ProjectRow, "name" | "description" | "status">>,
  ): Promise<ProjectRow | null> {
    const [row] = await this.txHost.tx
      .update(project)
      .set(patch)
      .where(and(this.scoped(scope), eq(project.id, projectId)))
      .returning();
    return row ?? null;
  }

  /** Soft delete (ADR 0032 lifecycle) — true when a live row was tombstoned. */
  async softDelete(scope: RequestScope, projectId: string): Promise<boolean> {
    const rows = await this.txHost.tx
      .update(project)
      .set({ deletedAt: new Date() })
      .where(and(this.scoped(scope), eq(project.id, projectId)))
      .returning({ id: project.id });
    return rows.length > 0;
  }

  /**
   * The project's instance roster (step 6.3c), keyed by instanceId. Loaded
   * only after the parent project's ownership is confirmed (the service gates
   * on `findById(scope, …)` first), so this takes no scope of its own. Ordered
   * by instanceId for a stable, reproducible roster.
   */
  async loadInstances(projectId: string): Promise<ProjectInstanceRow[]> {
    return this.txHost.tx
      .select()
      .from(projectInstance)
      .where(eq(projectInstance.projectId, projectId))
      .orderBy(asc(projectInstance.instanceId));
  }

  /**
   * Write the designed Site graph onto a project (scoped) — returns the row, or
   * null when the scope owns no such live project. The roster write
   * (`replaceInstances`) is a separate call the service sequences in the SAME
   * `@Transactional()` method, so site + roster commit atomically.
   */
  async updateSite(
    scope: RequestScope,
    projectId: string,
    site: unknown,
  ): Promise<ProjectRow | null> {
    const [row] = await this.txHost.tx
      .update(project)
      .set({ site })
      .where(and(this.scoped(scope), eq(project.id, projectId)))
      .returning();
    return row ?? null;
  }

  /**
   * Full-document replace of a project's roster: drop the old rows, insert the
   * new set. Caller MUST run inside the `@Transactional()` save (and after
   * `updateSite` confirmed ownership) — there is no scope filter here, the
   * project ownership gate upstream is the access control.
   */
  async replaceInstances(
    projectId: string,
    instances: Omit<NewProjectInstanceRow, "projectId">[],
  ): Promise<void> {
    await this.txHost.tx.delete(projectInstance).where(eq(projectInstance.projectId, projectId));
    if (instances.length === 0) return;
    await this.txHost.tx
      .insert(projectInstance)
      .values(instances.map((i) => ({ ...i, projectId })));
  }
}
