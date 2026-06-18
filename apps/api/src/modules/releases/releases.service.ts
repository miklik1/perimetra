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
  type PinVersionInput,
  type PublishReleaseInput,
  type ReleaseDetail,
  type ReleasesPage,
  type ReleaseSummary,
  type UpgradeOffer,
  type UpgradeOffers,
} from "@repo/validators/releases";

import { type RequestScope } from "../../common/tenancy/request-scope.js";
import { AuditService } from "../audit/audit.service.js";
import { CatalogVersionsService } from "../catalog-versions/catalog-versions.service.js";
import { ReleasesRepository, type AssignedReleaseMeta } from "./releases.repository.js";

/**
 * The engine derives a site against ONE catalog version (I5 `mixed_catalog`, and
 * the web bundle's loud guard). The PINNED releases an org configures together
 * must therefore share a catalog version — an opt-in that would split them is
 * refused LOUD (vs. silently breaking the configurator). Returns the conflicting
 * versions (sorted), or null when ≤1 distinct. Pure — unit-tested directly.
 */
export function catalogConflict(catalogVersions: number[]): number[] | null {
  const distinct = [...new Set(catalogVersions)].sort((a, b) => a - b);
  return distinct.length > 1 ? distinct : null;
}

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

  /** Tenant CONFIGURATOR list (ADR 0062 visibility + ADR 0064 pin): the releases
   *  assigned to the caller's org, NARROWED to the org's PINNED version per model
   *  (`/v1/releases` for the configurator/site bundle resolves through here). A
   *  newer assigned version of a model an org is using is an opt-in OFFER
   *  (`getUpgradeOffers`), not a parallel picker entry — CORE_SPEC §3. */
  async listForOrg(scope: RequestScope, query: ListReleasesQuery): Promise<ReleasesPage> {
    const { items, nextCursor } = await this.releases.listPinnedAssignedTo(
      scope.organizationId,
      query,
    );
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
    // Lazily pin the model to this version when the org has no pin for it yet
    // (the §3 default: the first assigned version is the active one). A NEWER
    // version of an already-pinned model NEVER moves the pin here — that is the
    // tenant's explicit opt-in (`pinVersion`). Idempotent + self-healing (runs
    // even on a re-assign, so an assignment can never lack its pin).
    await this.releases.ensurePin(organizationId, row.modelId, releaseId, actorUserId);
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
    if (removed === 0) return; // not assigned — no real change, no pin to drop, no audit
    // Pin hygiene (ADR 0064): a pin must never point at an unassigned release. If
    // this release was the model's active pin, drop it (the model becomes
    // unpinned — re-assign or opt-in re-establishes it). A still-assigned OTHER
    // version of the model is NOT auto-promoted: no silent version change. Sits
    // AFTER the guard so it (and the audit row) fire only on a REAL unassign — a
    // no-op never silently mutates pin state off the ledger (§7).
    await this.releases.deletePinByReleaseId(organizationId, releaseId);
    await this.audit.record({
      actorId: actorUserId,
      action: "release.unassign",
      entityType: "org_release_assignment",
      entityId: `${organizationId}:${releaseId}`,
      diff: { before: { organizationId, releaseId }, after: null },
    });
  }

  /** The release keys an org is currently assigned + its per-model active pins
   *  (ADR 0064) — the platform console view (assignment = availability, pin =
   *  the active version it configures with). */
  async listAssignments(organizationId: string): Promise<ReleaseAssignments> {
    const [releaseIds, pins] = await Promise.all([
      this.releases.findAssignedReleaseIds(organizationId),
      this.releases.findPins(organizationId),
    ]);
    return { organizationId, releaseIds, pins };
  }

  // --- Version pin / opt-in upgrade (CORE_SPEC §3, ADR 0064) ------------------

  /** The models the caller's org has an available upgrade for: it is pinned to a
   *  version older than the newest version of that model it is ALSO assigned
   *  (the vendor made the newer one available; the tenant has not opted in). The
   *  per-model offer powers the tenant `/admin` upgrade surface. */
  async getUpgradeOffers(scope: RequestScope): Promise<UpgradeOffers> {
    const assigned = await this.releases.findAssignedReleasesWithMeta(scope.organizationId);
    const pins = await this.releases.findPins(scope.organizationId);

    const byModel = new Map<string, AssignedReleaseMeta[]>();
    for (const a of assigned) {
      const list = byModel.get(a.modelId) ?? [];
      list.push(a);
      byModel.set(a.modelId, list);
    }

    const items: UpgradeOffer[] = [];
    for (const pin of pins) {
      const pinnedMeta = assigned.find((a) => a.releaseId === pin.pinnedReleaseId);
      if (!pinnedMeta) continue; // stale pin (pin hygiene should prevent this)
      const newer = (byModel.get(pin.modelId) ?? []).filter((a) => a.version > pinnedMeta.version);
      if (newer.length === 0) continue;
      const latest = newer.reduce((best, a) => (a.version > best.version ? a : best));
      items.push({
        modelId: pin.modelId,
        pinnedReleaseId: pin.pinnedReleaseId,
        pinnedVersion: pinnedMeta.version,
        latestReleaseId: latest.releaseId,
        latestVersion: latest.version,
        latestCatalogVersion: latest.catalogVersion,
      });
    }
    return { items };
  }

  /**
   * Opt into a version (CORE_SPEC §3): move the org's active pin for the target
   * release's model to `releaseId`. The target must be PUBLISHED and ASSIGNED to
   * the org (you can only pin a version the vendor made available). Pre-flight:
   * the post-move pinned set must still share one catalog version, else 422
   * `upgrade_catalog_conflict` (vs. silently breaking the configurator, I5).
   *
   * I3 is untouched: a quote stamps the exact "modelId@version" and re-derives
   * forever via the GLOBAL store regardless of where the pin later points. Old
   * project instances on the prior version are unaffected; only NEW work uses the
   * pinned version. Returns the org's remaining upgrade offers (post-move).
   */
  @Transactional()
  async pinVersion(scope: RequestScope, input: PinVersionInput): Promise<UpgradeOffers> {
    const row = await this.releases.findByReleaseId(input.releaseId);
    if (!row) throw new NotFoundException(`release ${input.releaseId} not found`);
    // Assignment gate BEFORE the status check: an unassigned release must not leak
    // its lifecycle — a 409 "is draft" would be an existence/status oracle on a
    // release the org cannot see (matches `get()`'s unassigned≈hidden contract).
    if (!(await this.releases.isAssigned(scope.organizationId, input.releaseId))) {
      throw new ForbiddenException({
        message: `release ${input.releaseId} is not assigned to your organization`,
        code: "release_not_assigned",
      });
    }
    if (row.status !== "published") {
      throw new ConflictException(`release ${input.releaseId} is ${row.status}, not pinnable`);
    }

    // ONE consistent read of the org's pins + each pinned release's catalog (a
    // single JOIN, not two statements), so a concurrent assign can't make the
    // pre-flight weigh a stale pin set against fresh catalogs (TOCTOU).
    const pinned = await this.releases.findPinnedReleaseCatalogs(scope.organizationId);
    const current = pinned.find((p) => p.modelId === row.modelId)?.pinnedReleaseId ?? null;
    if (current === input.releaseId) return this.getUpgradeOffers(scope); // no-op, no audit

    // Pre-flight: the post-move pinned set must still derive against ONE catalog.
    const postMoveCatalogs = new Map(pinned.map((p) => [p.modelId, p.catalogVersion]));
    postMoveCatalogs.set(row.modelId, row.catalogVersion);
    const conflict = catalogConflict([...postMoveCatalogs.values()]);
    if (conflict) {
      throw new UnprocessableEntityException({
        message: `pinning ${input.releaseId} (catalog@${row.catalogVersion}) would split your active products across catalog versions (${conflict.join(", ")}) — the configurator derives against one catalog`,
        code: "upgrade_catalog_conflict",
        catalogVersions: conflict,
      });
    }

    await this.releases.movePin(scope.organizationId, row.modelId, input.releaseId, scope.userId);
    await this.audit.record({
      actorId: scope.userId,
      action: "release.pin_changed",
      entityType: "org_model_pin",
      entityId: `${scope.organizationId}:${row.modelId}`,
      diff: {
        before: current ? { pinnedReleaseId: current } : null,
        after: { pinnedReleaseId: input.releaseId },
      },
    });
    return this.getUpgradeOffers(scope);
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
