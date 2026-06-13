/**
 * Catalog-versions service (ADR 0053) — publish + read the immutable vendor
 * catalog store. `publish` is `@Transactional()` (the insert and its audit row
 * commit together, ADR 0037); reads are decorator-free. There is no update or
 * delete: a published `catalog@N` is immutable (I3), so re-publishing a version
 * is a 409, never an overwrite.
 *
 * Append-only audit on every catalog mutation is the CORE_SPEC §7 requirement.
 */
import { Transactional } from "@nestjs-cls/transactional";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";

import { type CatalogVersionRow } from "@repo/db/schema/catalog-versions";
import { type Catalog } from "@repo/model";
import {
  type CatalogVersionDetail,
  type CatalogVersionsPage,
  type CatalogVersionSummary,
  type ListCatalogVersionsQuery,
  type PublishCatalogVersionInput,
} from "@repo/validators/catalog-versions";

import { type RequestScope } from "../../common/tenancy/request-scope.js";
import { AuditService } from "../audit/audit.service.js";
import { CatalogVersionsRepository } from "./catalog-versions.repository.js";

/** Structural gate for an incoming catalog body (the publish input is opaque
 *  `unknown`). The engine consumes the catalog as data; this guards the shape
 *  the engine relies on before it is frozen into the immutable store. */
function assertCatalogShape(body: unknown): Catalog {
  const c = body as Partial<Catalog> | null;
  if (
    c === null ||
    typeof c !== "object" ||
    typeof c.version !== "number" ||
    !Number.isInteger(c.version) ||
    typeof c.id !== "string" ||
    !Array.isArray(c.materials) ||
    !Array.isArray(c.sections) ||
    !Array.isArray(c.components)
  ) {
    throw new BadRequestException(
      "Invalid catalog body: expected { id, version:int, materials[], sections[], components[] }",
    );
  }
  return body as Catalog;
}

function toSummary(row: CatalogVersionRow): CatalogVersionSummary {
  return {
    id: row.id,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toDetail(row: CatalogVersionRow): CatalogVersionDetail {
  return { ...toSummary(row), body: row.body };
}

@Injectable()
export class CatalogVersionsService {
  constructor(
    private readonly catalogVersions: CatalogVersionsRepository,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListCatalogVersionsQuery): Promise<CatalogVersionsPage> {
    const { items, nextCursor } = await this.catalogVersions.list(query);
    return { items: items.map(toSummary), nextCursor };
  }

  async get(catalogVersionId: string): Promise<CatalogVersionDetail> {
    const row = await this.catalogVersions.findById(catalogVersionId);
    if (!row) throw new NotFoundException("Catalog version not found");
    return toDetail(row);
  }

  async getByVersion(version: number): Promise<CatalogVersionDetail> {
    const row = await this.catalogVersions.findByVersion(version);
    if (!row) throw new NotFoundException("Catalog version not found");
    return toDetail(row);
  }

  /** Cross-module load of the typed `Catalog` for a version — the release
   *  publish gate and the quote-issue derivation resolve stamps through this. */
  async loadCatalog(version: number): Promise<Catalog | null> {
    const row = await this.catalogVersions.findByVersion(version);
    return row ? (row.body as Catalog) : null;
  }

  // TODO(roles slice 6.3g): gate to the admin role. Authenticated-only for now.
  @Transactional()
  async publish(
    scope: RequestScope,
    input: PublishCatalogVersionInput,
  ): Promise<CatalogVersionDetail> {
    const catalog = assertCatalogShape(input.body);
    const existing = await this.catalogVersions.findByVersion(catalog.version);
    if (existing) {
      throw new ConflictException(
        `catalog@${catalog.version} is already published (immutable, I3)`,
      );
    }
    const row = await this.catalogVersions.insert({ version: catalog.version, body: catalog });
    await this.audit.record({
      actorId: scope.userId,
      action: "catalog-version.publish",
      entityType: "catalog-version",
      entityId: row.id,
      diff: { before: null, after: { version: catalog.version } },
    });
    return toDetail(row);
  }
}
