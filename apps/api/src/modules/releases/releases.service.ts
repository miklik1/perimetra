/**
 * Releases service (ADR 0053) — publish + read the immutable vendor release
 * store. `publish` is `@Transactional()` (insert + audit commit together,
 * ADR 0037). No update/delete: a published release is immutable (I3), so
 * re-publishing a "modelId@version" is a 409.
 *
 * The publish gate is the I2-adjacent contract: a release MUST pass
 * `validateRelease` against its named catalog version before it is frozen —
 * the same gate the fixtures harness runs, so a broken model can never ship.
 * Append-only audit on every release mutation is the CORE_SPEC §7 requirement.
 */
import { Transactional } from "@nestjs-cls/transactional";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";

import { type ReleaseRow } from "@repo/db/schema/releases";
import { gateInput, type ConfigInput } from "@repo/engine";
import { assertValidRelease, ReleaseValidationError, type ProductModelRelease } from "@repo/model";
import { type ReleaseAssignments } from "@repo/validators/platform";
import {
  type ListReleasesQuery,
  type PublishReleaseInput,
  type ReleaseDetail,
  type ReleasesPage,
  type ReleaseSummary,
} from "@repo/validators/releases";

import { type RequestScope } from "../../common/tenancy/request-scope.js";
import { AuditService } from "../audit/audit.service.js";
import { CatalogVersionsService } from "../catalog-versions/catalog-versions.service.js";
import { ReleasesRepository } from "./releases.repository.js";

/** Structural gate for an incoming release body (the publish input is opaque
 *  `unknown`). Guards the top-level shape `validateRelease` assumes before the
 *  deep semantic gate runs (so malformed input is a clean 400, not a 500). */
function assertReleaseEnvelope(body: unknown): ProductModelRelease {
  const r = body as Partial<ProductModelRelease> | null;
  if (
    r === null ||
    typeof r !== "object" ||
    typeof r.id !== "string" ||
    typeof r.modelId !== "string" ||
    typeof r.version !== "number" ||
    !Number.isInteger(r.version) ||
    !Array.isArray(r.parameters) ||
    !Array.isArray(r.constraints) ||
    typeof r.derivation !== "object" ||
    r.derivation === null ||
    !Array.isArray(r.derivation.derived) ||
    !Array.isArray(r.derivation.parts)
  ) {
    throw new BadRequestException(
      "Invalid release body: expected a ProductModelRelease { id, modelId, version, parameters[], constraints[], derivation }",
    );
  }
  return body as ProductModelRelease;
}

function toSummary(row: ReleaseRow): ReleaseSummary {
  return {
    id: row.id,
    releaseId: row.releaseId,
    modelId: row.modelId,
    version: row.version,
    catalogVersion: row.catalogVersion,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toDetail(row: ReleaseRow): ReleaseDetail {
  return {
    ...toSummary(row),
    body: row.body,
    initialInput: (row.initialInput as ConfigInput) ?? null,
  };
}

@Injectable()
export class ReleasesService {
  constructor(
    private readonly releases: ReleasesRepository,
    private readonly catalogVersions: CatalogVersionsService,
    private readonly audit: AuditService,
  ) {}

  /** GLOBAL list of every release (the platform/vendor picker — ADR 0062). NOT
   *  tenant-scoped; reachable only behind `PlatformGuard`. Tenant surfaces use
   *  {@link listForOrg}. */
  async list(query: ListReleasesQuery): Promise<ReleasesPage> {
    const { items, nextCursor } = await this.releases.list(query);
    return { items: items.map(toSummary), nextCursor };
  }

  /** Tenant-facing list (ADR 0062): only the releases ASSIGNED to the caller's
   *  org — the per-tenant visibility filter (`/v1/releases` for the configurator/
   *  site bundle resolves through here). */
  async listForOrg(scope: RequestScope, query: ListReleasesQuery): Promise<ReleasesPage> {
    const { items, nextCursor } = await this.releases.listAssignedTo(scope.organizationId, query);
    return { items: items.map(toSummary), nextCursor };
  }

  /** Detail by surrogate id — TENANT-scoped (ADR 0062): 404 unless the release
   *  is assigned to the caller's org, so a tenant reads only bodies it can see
   *  (and an unassigned id is indistinguishable from a missing one — no existence
   *  leak). The configurator bundle only ever fetches ids the assigned list gave
   *  it. Internal re-derivation uses {@link loadByReleaseId} (global), not this. */
  async get(scope: RequestScope, releaseRowId: string): Promise<ReleaseDetail> {
    const row = await this.releases.findById(releaseRowId);
    if (!row || !(await this.releases.isAssigned(scope.organizationId, row.releaseId))) {
      throw new NotFoundException("Release not found");
    }
    return toDetail(row);
  }

  /** Cross-module load of the persisted release detail (body + its pinned
   *  catalogVersion) for a natural key — quote-issue resolves the derivation
   *  release AND its catalog through this; reproduction (I3) reloads the exact
   *  immutable body the stamp points at. */
  async loadByReleaseId(releaseId: string): Promise<ReleaseDetail | null> {
    const row = await this.releases.findByReleaseId(releaseId);
    return row ? toDetail(row) : null;
  }

  // Vendor-only publish — authoring is the platform operator's, permanently
  // (CORE_SPEC §3); `PlatformGuard` on the controller (ADR 0062, was the org
  // `@RequireRole('admin')` of ADR 0056). `scope.userId` is the audit actor.
  @Transactional()
  async publish(scope: RequestScope, input: PublishReleaseInput): Promise<ReleaseDetail> {
    const body = assertReleaseEnvelope(input.body);

    const catalog = await this.catalogVersions.loadCatalog(input.catalogVersion);
    if (!catalog) {
      throw new BadRequestException(
        `catalog@${input.catalogVersion} is not published — publish the catalog version first`,
      );
    }

    // The publish gate (I2): a release with defects cannot ship.
    try {
      assertValidRelease(body, catalog);
    } catch (error) {
      if (error instanceof ReleaseValidationError) {
        throw new UnprocessableEntityException({
          message: "Release validation failed",
          code: "release_invalid",
          defects: error.defects,
        });
      }
      throw error;
    }

    // The configurator opens on `initialInput`; a bad example would render an
    // invalid/blank product. Gate it against the release (the same I7 input gate
    // the engine runs) so a broken starting config can never be frozen in.
    if (input.initialInput) {
      const issues = gateInput(body, input.initialInput as ConfigInput);
      if (issues.length > 0) {
        throw new UnprocessableEntityException({
          message: "initialInput is not a valid configuration for this release",
          code: "initial_input_invalid",
          issues,
        });
      }
    }

    const existing = await this.releases.findByReleaseId(body.id);
    if (existing) {
      throw new ConflictException(`${body.id} is already published (immutable, I3)`);
    }

    const published: ProductModelRelease = { ...body, status: "published" };
    const row = await this.releases.insert({
      releaseId: published.id,
      modelId: published.modelId,
      version: published.version,
      catalogVersion: input.catalogVersion,
      status: "published",
      body: published,
      initialInput: input.initialInput ?? null,
    });

    await this.audit.record({
      actorId: scope.userId,
      action: "release.publish",
      entityType: "release",
      entityId: row.id,
      diff: {
        before: null,
        after: { releaseId: published.id, catalogVersion: input.catalogVersion },
      },
    });
    return toDetail(row);
  }

  // --- Per-tenant release assignment (ADR 0062) ------------------------------
  // The vendor (platform operator) controls which releases each tenant org may
  // see/configure. These are CROSS-ORG writes (the target `organizationId` is a
  // parameter, not the actor's own org), so they take explicit args rather than
  // a `RequestScope` and are reachable only behind `PlatformGuard`. Audited as a
  // catalog-access mutation (CORE_SPEC §7).

  /** Assign a published release to an org. The release must exist and be
   *  published (a retired/absent one is not assignable). Idempotent. */
  @Transactional()
  async assign(actorUserId: string, organizationId: string, releaseId: string): Promise<void> {
    const row = await this.releases.findByReleaseId(releaseId);
    if (!row) throw new NotFoundException(`release ${releaseId} not found`);
    if (row.status !== "published") {
      throw new ConflictException(`release ${releaseId} is ${row.status}, not assignable`);
    }
    const inserted = await this.releases.assign(organizationId, releaseId, actorUserId);
    if (!inserted) return; // idempotent re-assign — no real change, no audit row
    await this.audit.record({
      actorId: actorUserId,
      action: "release.assign",
      entityType: "org_release_assignment",
      entityId: `${organizationId}:${releaseId}`,
      diff: { before: null, after: { organizationId, releaseId } },
    });
  }

  /** Remove a release assignment from an org. A no-op (not assigned) writes no
   *  audit row — the ledger records real state changes only. */
  @Transactional()
  async unassign(actorUserId: string, organizationId: string, releaseId: string): Promise<void> {
    const removed = await this.releases.unassign(organizationId, releaseId);
    if (removed === 0) return;
    await this.audit.record({
      actorId: actorUserId,
      action: "release.unassign",
      entityType: "org_release_assignment",
      entityId: `${organizationId}:${releaseId}`,
      diff: { before: { organizationId, releaseId }, after: null },
    });
  }

  /** The release keys an org is currently assigned (the platform console view). */
  async listAssignments(organizationId: string): Promise<ReleaseAssignments> {
    const releaseIds = await this.releases.findAssignedReleaseIds(organizationId);
    return { organizationId, releaseIds };
  }

  /**
   * Defense-in-depth gate (ADR 0062): every release in `releaseIds` MUST be
   * assigned to the caller's org, else 403 `release_not_assigned`. The
   * configurator only OFFERS assigned releases (the `listForOrg` filter); this
   * closes the direct-API seam at quote `issue`. Re-derivation
   * (`verifyReproducibility`) deliberately does NOT call this — a quote stamped
   * on a since-unassigned release must still reproduce byte-identically
   * (I3 ≠ visibility).
   */
  async assertAssigned(scope: RequestScope, releaseIds: string[]): Promise<void> {
    for (const releaseId of new Set(releaseIds)) {
      if (!(await this.releases.isAssigned(scope.organizationId, releaseId))) {
        throw new ForbiddenException({
          message: `release ${releaseId} is not assigned to your organization`,
          code: "release_not_assigned",
        });
      }
    }
  }
}
