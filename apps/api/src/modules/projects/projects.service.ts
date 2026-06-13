/**
 * Reference service (spec §7.8): `@Transactional()` on every write — the
 * state change, the outbox event and the audit row commit or roll back as
 * ONE transaction (ADR 0037). Reads stay decorator-free (no tx needed; the
 * repository falls back to the pooled client).
 *
 * Events carry IDs only (`{ projectId }`) — handlers re-fetch (spec §7.2).
 */
import { Transactional } from "@nestjs-cls/transactional";
import { Injectable, NotFoundException } from "@nestjs/common";

import { type ProjectInstanceRow, type ProjectRow } from "@repo/db/schema/projects";
import {
  type CreateProjectInput,
  type ListProjectsQuery,
  type Project,
  type ProjectInstanceInput,
  type ProjectSite,
  type ProjectsPage,
  type SaveProjectSiteInput,
  type UpdateProjectInput,
} from "@repo/validators/projects";

import { type RequestScope } from "../../common/tenancy/request-scope.js";
import { AuditService } from "../audit/audit.service.js";
import { OutboxService } from "../outbox/outbox.service.js";
import { ProjectsRepository } from "./projects.repository.js";
import { PROJECT_ARCHIVED, PROJECT_CREATED } from "./projects.tokens.js";

/** Fields the audit diff tracks — the client-visible, mutable surface. */
const AUDITED_FIELDS = ["name", "description", "status"] as const;

/** DB row → response contract (Dates become ISO strings, internals dropped). */
function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Roster row → contract entry. `null` overrides drop to `undefined` (absent on
 *  the wire); `input` is opaque ConfigInput, `overrides` opaque CascadeLayers. */
function toProjectInstance(row: ProjectInstanceRow): ProjectInstanceInput {
  return {
    instanceId: row.instanceId,
    releaseId: row.releaseId,
    input: row.input as Record<string, unknown>,
    ...(row.overrides != null && { overrides: row.overrides }),
  };
}

/** before/after restricted to the fields that actually changed. */
function auditDiff(
  before: ProjectRow,
  after: ProjectRow,
): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const diff = { before: {} as Record<string, unknown>, after: {} as Record<string, unknown> };
  for (const field of AUDITED_FIELDS) {
    if (before[field] !== after[field]) {
      diff.before[field] = before[field];
      diff.after[field] = after[field];
    }
  }
  return diff;
}

@Injectable()
export class ProjectsService {
  constructor(
    private readonly projects: ProjectsRepository,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
  ) {}

  async list(scope: RequestScope, query: ListProjectsQuery): Promise<ProjectsPage> {
    const { items, nextCursor } = await this.projects.list(scope, query);
    return { items: items.map(toProject), nextCursor };
  }

  /** 404 covers both "doesn't exist" and "not yours" — no existence oracle. */
  async get(scope: RequestScope, projectId: string): Promise<Project> {
    const row = await this.projects.findById(scope, projectId);
    if (!row) throw new NotFoundException("Project not found");
    return toProject(row);
  }

  @Transactional()
  async create(scope: RequestScope, input: CreateProjectInput): Promise<Project> {
    const row = await this.projects.insert(scope, input);
    await this.outbox.emit({
      aggregateType: "project",
      aggregateId: row.id,
      eventType: PROJECT_CREATED,
      payload: { projectId: row.id },
    });
    await this.audit.record({
      actorId: scope.userId,
      action: "project.create",
      entityType: "project",
      entityId: row.id,
      diff: {
        before: null,
        after: { name: row.name, description: row.description, status: row.status },
      },
    });
    return toProject(row);
  }

  @Transactional()
  async update(
    scope: RequestScope,
    projectId: string,
    input: UpdateProjectInput,
  ): Promise<Project> {
    const before = await this.projects.findById(scope, projectId);
    if (!before) throw new NotFoundException("Project not found");

    const patch: { name?: string; description?: string } = {};
    if (input.name !== undefined && input.name !== before.name) patch.name = input.name;
    if (input.description !== undefined && input.description !== before.description) {
      patch.description = input.description;
    }
    // No-op patch: skip the write AND the audit row — nothing changed.
    if (Object.keys(patch).length === 0) return toProject(before);

    const row = await this.projects.update(scope, projectId, patch);
    if (!row) throw new NotFoundException("Project not found");

    await this.audit.record({
      actorId: scope.userId,
      action: "project.update",
      entityType: "project",
      entityId: projectId,
      diff: auditDiff(before, row),
    });
    return toProject(row);
  }

  @Transactional()
  async archive(scope: RequestScope, projectId: string): Promise<Project> {
    const before = await this.projects.findById(scope, projectId);
    if (!before) throw new NotFoundException("Project not found");
    // Idempotent: archiving an archived project changes (and emits) nothing.
    if (before.status === "archived") return toProject(before);

    const row = await this.projects.update(scope, projectId, { status: "archived" });
    if (!row) throw new NotFoundException("Project not found");

    await this.outbox.emit({
      aggregateType: "project",
      aggregateId: projectId,
      eventType: PROJECT_ARCHIVED,
      payload: { projectId },
    });
    await this.audit.record({
      actorId: scope.userId,
      action: "project.archive",
      entityType: "project",
      entityId: projectId,
      diff: auditDiff(before, row),
    });
    return toProject(row);
  }

  @Transactional()
  async softDelete(scope: RequestScope, projectId: string): Promise<void> {
    const deleted = await this.projects.softDelete(scope, projectId);
    if (!deleted) throw new NotFoundException("Project not found");

    await this.audit.record({
      actorId: scope.userId,
      action: "project.delete",
      entityType: "project",
      entityId: projectId,
      // No diff: the row state is unchanged except the tombstone.
    });
  }

  /**
   * The project's designed site (step 6.3c): the Site graph + instance roster.
   * 404 covers "doesn't exist" and "not yours" (same as `get`). A project with
   * no site yet returns `{ site: null, instances: [] }` — a valid empty canvas.
   */
  async getSite(scope: RequestScope, projectId: string): Promise<ProjectSite> {
    const row = await this.projects.findById(scope, projectId);
    if (!row) throw new NotFoundException("Project not found");
    const instances = await this.projects.loadInstances(projectId);
    return { site: row.site ?? null, instances: instances.map(toProjectInstance) };
  }

  /**
   * Full-document replace of a project's site + roster (step 6.3c) — the canvas
   * holds the whole site in memory and saves it wholesale. `updateSite` is the
   * ownership gate (null → 404); the roster replace runs in the SAME
   * transaction, so site and roster never diverge. Audited with a light diff
   * (instance count) — the Site blob itself is too large to diff usefully, and
   * the immutable quote snapshot is the real reproducibility record (I3).
   */
  @Transactional()
  async saveSite(
    scope: RequestScope,
    projectId: string,
    input: SaveProjectSiteInput,
  ): Promise<ProjectSite> {
    const row = await this.projects.updateSite(scope, projectId, input.site);
    if (!row) throw new NotFoundException("Project not found");

    await this.projects.replaceInstances(
      projectId,
      input.instances.map((i) => ({
        instanceId: i.instanceId,
        releaseId: i.releaseId,
        input: i.input,
        overrides: i.overrides ?? null,
      })),
    );

    await this.audit.record({
      actorId: scope.userId,
      action: "project.site.save",
      entityType: "project",
      entityId: projectId,
      diff: { before: null, after: { instanceCount: input.instances.length } },
    });

    return { site: input.site ?? null, instances: input.instances };
  }
}
