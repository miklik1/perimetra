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
import { checkFixtures, gateInput, type ConfigInput } from "@repo/engine";
import { assertValidRelease, ReleaseValidationError, type ProductModelRelease } from "@repo/model";
import { type BroadcastAssignResult, type ReleaseAssignments } from "@repo/validators/platform";
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

  /** Detail by surrogate id — PLATFORM-scoped (ADR 0062/0067): GLOBAL, no
   *  assignment gate, so the vendor console can inspect ANY published/retired
   *  release body (the tenant {@link get} 404s anything the caller's own org is
   *  not assigned — useless for an operator). Reachable only behind
   *  `PlatformGuard`. 404 only when the id genuinely does not exist. */
  async getGlobal(releaseRowId: string): Promise<ReleaseDetail> {
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

    // I2 execution: each fixture must reproduce its expected DERIVED values
    // against the catalog (price-free — totalPrice depends on a tenant price
    // table, so it's regression-locked in the proving harness, not here).
    const fixtureFailures = checkFixtures(body, catalog).filter((c) => !c.ok);
    if (fixtureFailures.length > 0) {
      throw new UnprocessableEntityException({
        message: "Release fixtures did not reproduce their expected values (I2)",
        code: "fixtures_failed",
        failures: fixtureFailures,
      });
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

  /**
   * Retire a published release (CORE_SPEC §3 status `published`→`retired`, ADR
   * 0067) — vendor-only (`PlatformGuard`, like `publish`). A retired version is
   * no longer OFFERED for new work: it cannot be newly assigned, broadcast, or
   * pinned (those guards already reject a non-published row — `assign`/
   * `broadcastAssign`/`pinVersion`), and `getUpgradeOffers` drops it as an opt-in
   * target. NON-STRANDING (Martin's call): an org already pinned to it keeps
   * configuring with it (the configurator list does NOT status-filter) — the
   * vendor's lever to move tenants off a bad version is to publish a fix and
   * BROADCAST it, not to strand them. I3 is untouched: the body is never
   * mutated and the row is never deleted, so a quote stamped on it re-derives
   * forever (`assertAssigned`/re-derivation are status-agnostic).
   *
   * Idempotent: re-retiring an already-retired release is a no-op 200 (no audit
   * row — the ledger records real state changes only). A draft (not reachable
   * via the publish API, which always freezes `published`) 409s — only a
   * published release can be retired.
   */
  @Transactional()
  async retire(actorUserId: string, releaseId: string): Promise<ReleaseDetail> {
    const row = await this.releases.findByReleaseId(releaseId);
    if (!row) throw new NotFoundException(`release ${releaseId} not found`);
    if (row.status === "retired") return toDetail(row); // idempotent — no real change, no audit
    if (row.status !== "published") {
      throw new ConflictException(
        `release ${releaseId} is ${row.status}; only a published release can be retired`,
      );
    }

    const retired = await this.releases.retire(releaseId);
    // The conditional UPDATE (WHERE status='published') matched nothing: a
    // concurrent retire won the race. Re-read and return idempotently — still
    // no audit row (the winning tx wrote it).
    if (!retired) {
      const fresh = await this.releases.findByReleaseId(releaseId);
      return toDetail(fresh ?? row);
    }

    await this.audit.record({
      actorId: actorUserId,
      action: "release.retire",
      entityType: "release",
      entityId: retired.id,
      diff: { before: { status: "published" }, after: { status: "retired" } },
    });
    return toDetail(retired);
  }

  // --- Per-tenant release assignment (ADR 0062) ------------------------------
  // The vendor (platform operator) controls which releases each tenant org may
  // see/configure. These are CROSS-ORG writes (the target `organizationId` is a
  // parameter, not the actor's own org), so they take explicit args rather than
  // a `RequestScope` and are reachable only behind `PlatformGuard`. Audited as a
  // catalog-access mutation (CORE_SPEC §7).

  /** Assign a published release to an org. The release must exist and be
   *  published (a retired/absent one is not assignable). Idempotent. Returns
   *  whether a NEW assignment was created (false on an idempotent re-assign) —
   *  the broadcast fan-out uses this to report assigned-vs-already-assigned. */
  @Transactional()
  async assign(actorUserId: string, organizationId: string, releaseId: string): Promise<boolean> {
    const row = await this.releases.findByReleaseId(releaseId);
    if (!row) throw new NotFoundException(`release ${releaseId} not found`);
    if (row.status !== "published") {
      throw new ConflictException(`release ${releaseId} is ${row.status}, not assignable`);
    }
    return this.assignValidated(actorUserId, organizationId, row);
  }

  /**
   * Assign an ALREADY-validated published release row to an org. Splits the
   * write off {@link assign}'s fetch+validate so the broadcast fan-out validates
   * the immutable release ONCE up front and reuses the row for every org (no
   * per-org re-read — the row never changes, I3). Its own `@Transactional()`
   * unit: `assign` joins it (REQUIRED propagation), while a broadcast loop runs
   * each org as an isolated, idempotent transaction with atomic
   * state-change-plus-audit (ADR 0037). Lazily pins the model (the §3 first-
   * assign default); a NEWER version NEVER moves an existing pin — that stays
   * the tenant's explicit opt-in (`pinVersion`).
   */
  @Transactional()
  private async assignValidated(
    actorUserId: string,
    organizationId: string,
    row: ReleaseRow,
  ): Promise<boolean> {
    const inserted = await this.releases.assign(organizationId, row.releaseId, actorUserId);
    await this.releases.ensurePin(organizationId, row.modelId, row.releaseId, actorUserId);
    if (!inserted) return false; // idempotent re-assign — no real change, no audit row
    await this.audit.record({
      actorId: actorUserId,
      action: "release.assign",
      entityType: "org_release_assignment",
      entityId: `${organizationId}:${row.releaseId}`,
      diff: { before: null, after: { organizationId, releaseId: row.releaseId } },
    });
    return true;
  }

  /**
   * Vendor BROADCAST of an upgrade offer (CORE_SPEC §3) — the fan-out half
   * ADR 0064 deferred. Make a newly published release available to EVERY org
   * currently on an OLDER version of its model, in ONE operation, so each gets
   * an opt-in "upgrade available" offer (`getUpgradeOffers`) instead of the
   * vendor assigning per org by hand.
   *
   * It NEVER moves a pin: it calls the SAME {@link assign} a single per-org
   * assignment uses (→ `ensurePin` ON CONFLICT DO NOTHING), so a targeted org
   * keeps its active version and the new one surfaces only as an explicit
   * opt-in (§3 "upgrades are explicit opt-in per tenant"). I3 ≠ visibility ≠
   * pin is untouched — assignment is disposable; a quote re-derives via the
   * GLOBAL store regardless of what is assigned or pinned.
   *
   * The new release is validated ONCE up front (exists + published → fail HARD
   * 404/409, before any write) and the row is reused for every org. Targets are
   * read from the DB (orgs pinned to an older version of the model), NEVER the
   * caller. Deliberately NOT wrapped in one outer `@Transactional()`: each
   * `assignValidated` is its own transactional unit, so the fan-out is per-org
   * isolated and idempotent (a re-broadcast is a no-op).
   *
   * Per-org errors PROPAGATE rather than being swallowed: a bulk op must never
   * mask an infra fault (DB down, pool exhausted) as success. The one benign
   * case this also surfaces is a concurrent org hard-delete — the pin is read,
   * then the org (and its pin) CASCADE-deleted, so that org's assign FK-fails.
   * Rather than couple this service to the pg driver's error codes to skip it
   * (an FK-violation translation is a repository concern, not a service one),
   * we let it propagate: partial progress is already committed, the run is
   * idempotent, and a retry completes cleanly (the deleted org has dropped out
   * of the target set). The race window is sub-second over a small trusted-
   * tenant fleet, so the imprecision costs nothing in practice.
   */
  async broadcastAssign(actorUserId: string, newReleaseId: string): Promise<BroadcastAssignResult> {
    const row = await this.releases.findByReleaseId(newReleaseId);
    if (!row) throw new NotFoundException(`release ${newReleaseId} not found`);
    if (row.status !== "published") {
      throw new ConflictException(`release ${newReleaseId} is ${row.status}, not assignable`);
    }

    const targetOrgIds = await this.releases.findOrgsBehindOnModel(row.modelId, row.version);
    const assignedOrgIds: string[] = [];
    const skippedOrgIds: string[] = [];
    for (const organizationId of targetOrgIds) {
      const inserted = await this.assignValidated(actorUserId, organizationId, row);
      (inserted ? assignedOrgIds : skippedOrgIds).push(organizationId);
    }
    return { releaseId: newReleaseId, assignedOrgIds, skippedOrgIds };
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
      // A RETIRED newer version is never an opt-in target (ADR 0067): it would
      // 409 at `pinVersion`, so offering it is a dead end. The pinned version
      // itself may be retired (non-stranding) — that still surfaces a published
      // upgrade if one exists ("you are on a retired v1, v3 is available").
      const newer = (byModel.get(pin.modelId) ?? []).filter(
        (a) => a.version > pinnedMeta.version && a.status === "published",
      );
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
   * the org (you can only pin a version the vendor made available). There is NO
   * catalog pre-flight: per-release catalog (ADR 0065) lets the newly pinned
   * version carry a different catalog version than the org's other products —
   * each release derives against its OWN catalog, so a mixed pinned set is a
   * fully supported state (this completes ADR 0064, retiring its
   * `upgrade_catalog_conflict` guard, which would now refuse a VALID state).
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

    const current =
      (await this.releases.findPins(scope.organizationId)).find((p) => p.modelId === row.modelId)
        ?.pinnedReleaseId ?? null;
    if (current === input.releaseId) return this.getUpgradeOffers(scope); // no-op, no audit

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
