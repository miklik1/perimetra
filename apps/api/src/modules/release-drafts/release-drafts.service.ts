/**
 * ReleaseDrafts service (ADR 0068 Phase 3) — the MUTABLE author workspace. A
 * draft only holds in-progress editor state; PUBLISH stays the existing
 * immutable `POST /v1/releases` path (no second freeze, I3 untouched), and
 * clone-and-bump is a client-side reverse-map then a normal `create` — so this
 * service is a pure CRUD store with no engine/release coupling.
 *
 * Audit policy: `create` and `delete` bracket the draft lifecycle and are
 * audited; `update` is high-frequency autosave working-state churn (a body
 * re-dump every few seconds) — auditing each would bloat the log for no
 * compliance value, and the published release is audited on its own path. So
 * `update` writes neither an audit row nor a transaction (a single atomic
 * UPDATE on the pooled client).
 */
import { Transactional } from "@nestjs-cls/transactional";
import { Injectable, NotFoundException } from "@nestjs/common";

import { type ReleaseDraftRow } from "@repo/db/schema/release-drafts";
import {
  type CreateReleaseDraftInput,
  type ListReleaseDraftsQuery,
  type ReleaseDraft,
  type ReleaseDraftsPage,
  type ReleaseDraftSummary,
  type UpdateReleaseDraftInput,
} from "@repo/validators/release-drafts";

import { type RequestScope } from "../../common/tenancy/request-scope.js";
import { AuditService } from "../audit/audit.service.js";
import { ReleaseDraftsRepository, type ReleaseDraftData } from "./release-drafts.repository.js";

/** DB row → list contract (Dates → ISO strings, internals + heavy body dropped). */
function toSummary(row: ReleaseDraftRow): ReleaseDraftSummary {
  return {
    id: row.id,
    modelId: row.modelId,
    version: row.version,
    catalogVersion: row.catalogVersion,
    baseReleaseId: row.baseReleaseId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** DB row → detail contract (summary + the opaque editor form state). */
function toReleaseDraft(row: ReleaseDraftRow): ReleaseDraft {
  return { ...toSummary(row), body: row.body };
}

@Injectable()
export class ReleaseDraftsService {
  constructor(
    private readonly releaseDrafts: ReleaseDraftsRepository,
    private readonly audit: AuditService,
  ) {}

  async list(scope: RequestScope, query: ListReleaseDraftsQuery): Promise<ReleaseDraftsPage> {
    const { items, nextCursor } = await this.releaseDrafts.list(scope, query);
    return { items: items.map(toSummary), nextCursor };
  }

  /** 404 covers both "doesn't exist" and "not your org" — no existence oracle. */
  async get(scope: RequestScope, releaseDraftId: string): Promise<ReleaseDraft> {
    const row = await this.releaseDrafts.findById(scope, releaseDraftId);
    if (!row) throw new NotFoundException("ReleaseDraft not found");
    return toReleaseDraft(row);
  }

  @Transactional()
  async create(scope: RequestScope, input: CreateReleaseDraftInput): Promise<ReleaseDraft> {
    const row = await this.releaseDrafts.insert(scope, {
      modelId: input.modelId,
      version: input.version,
      catalogVersion: input.catalogVersion,
      baseReleaseId: input.baseReleaseId,
      // A brand-new blank draft may carry no body yet — store an empty object so
      // the NOT NULL jsonb column holds and the editor can `form.reset({})`.
      body: input.body ?? {},
    });
    await this.audit.record({
      actorId: scope.userId,
      action: "release-draft.create",
      entityType: "release-draft",
      entityId: row.id,
      diff: { before: null, after: { modelId: row.modelId, version: row.version } },
    });
    return toReleaseDraft(row);
  }

  /** Autosave: overwrite whatever the editor sent. No audit / no tx (see header). */
  async update(
    scope: RequestScope,
    releaseDraftId: string,
    input: UpdateReleaseDraftInput,
  ): Promise<ReleaseDraft> {
    const patch: Partial<ReleaseDraftData> = {};
    if (input.modelId !== undefined) patch.modelId = input.modelId;
    if (input.version !== undefined) patch.version = input.version;
    if (input.catalogVersion !== undefined) patch.catalogVersion = input.catalogVersion;
    if (input.baseReleaseId !== undefined) patch.baseReleaseId = input.baseReleaseId;
    if (input.body !== undefined) patch.body = input.body;

    // Nothing to write — return the current row (404 if absent/foreign).
    if (Object.keys(patch).length === 0) return this.get(scope, releaseDraftId);

    const row = await this.releaseDrafts.update(scope, releaseDraftId, patch);
    if (!row) throw new NotFoundException("ReleaseDraft not found");
    return toReleaseDraft(row);
  }

  @Transactional()
  async softDelete(scope: RequestScope, releaseDraftId: string): Promise<void> {
    const deleted = await this.releaseDrafts.softDelete(scope, releaseDraftId);
    if (!deleted) throw new NotFoundException("ReleaseDraft not found");

    await this.audit.record({
      actorId: scope.userId,
      action: "release-draft.delete",
      entityType: "release-draft",
      entityId: releaseDraftId,
      // No diff: the row state is unchanged except the tombstone.
    });
  }
}
