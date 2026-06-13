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
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";

import { type ReleaseRow } from "@repo/db/schema/releases";
import { assertValidRelease, ReleaseValidationError, type ProductModelRelease } from "@repo/model";
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
  return { ...toSummary(row), body: row.body };
}

@Injectable()
export class ReleasesService {
  constructor(
    private readonly releases: ReleasesRepository,
    private readonly catalogVersions: CatalogVersionsService,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListReleasesQuery): Promise<ReleasesPage> {
    const { items, nextCursor } = await this.releases.list(query);
    return { items: items.map(toSummary), nextCursor };
  }

  async get(releaseRowId: string): Promise<ReleaseDetail> {
    const row = await this.releases.findById(releaseRowId);
    if (!row) throw new NotFoundException("Release not found");
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

  // TODO(roles slice 6.3g): gate to the admin role. Authenticated-only for now.
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
}
