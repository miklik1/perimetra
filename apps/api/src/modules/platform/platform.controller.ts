/**
 * Platform/vendor console (CORE_SPEC §3, ADR 0062) — the cross-tenant surface
 * only the platform OPERATOR may reach. `SessionGuard` authenticates;
 * `PlatformGuard` requires Better Auth `user.role==='admin'` (resolved fresh —
 * see the guard). Every route is cross-tenant by design (the `:orgId` is any
 * tenant, not the operator's own org), so this controller deliberately does NOT
 * use `@CurrentScope()`/`scoped()` — the platform tier sits ABOVE per-org scope.
 *
 * Reads/orchestrates the owning services (ADR 0032 — never a schema join):
 *  - `ReleasesService` — the global release list (assignment picker) + the
 *    `org_release_assignment` writes (assign/unassign) + the per-org view.
 *  - `OrganizationsService` — the tenant org list (+ existence guard).
 *
 * Note: publishing releases/catalog is platform-gated on THOSE controllers
 * (releases/catalog-versions), not duplicated here — this controller owns
 * assignment + discovery, not authoring.
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";

import {
  type CatalogVersionDetail,
  type CatalogVersionsPage,
} from "@repo/validators/catalog-versions";
import {
  type BroadcastAssignResult,
  type PlatformOrganizations,
  type ReleaseAssignments,
} from "@repo/validators/platform";
import { type ReleaseDetail, type ReleasesPage } from "@repo/validators/releases";

import { ZodSerializerDto } from "../../common/api/zod.js";
import { CurrentSession } from "../auth/current-session.decorator.js";
import { OrganizationsService } from "../auth/organizations.service.js";
import { PlatformGuard } from "../auth/platform.guard.js";
import { SessionGuard, type SessionContext } from "../auth/session.guard.js";
import { CatalogVersionsService } from "../catalog-versions/catalog-versions.service.js";
import { ReleasesService } from "../releases/releases.service.js";
import {
  AssignReleaseDto,
  BroadcastAssignResultDto,
  PlatformCatalogVersionDto,
  PlatformCatalogVersionsPageDto,
  PlatformCatalogVersionsQueryDto,
  PlatformOrganizationsDto,
  PlatformReleaseDto,
  PlatformReleasesPageDto,
  PlatformReleasesQueryDto,
  ReleaseAssignmentsDto,
} from "./platform.dto.js";

@Controller("platform")
@UseGuards(SessionGuard, PlatformGuard)
export class PlatformController {
  constructor(
    private readonly releases: ReleasesService,
    private readonly organizations: OrganizationsService,
    private readonly catalogVersions: CatalogVersionsService,
  ) {}

  /** Every published release — the vendor's assignment picker (global, ADR 0062). */
  @Get("releases")
  @ZodSerializerDto(PlatformReleasesPageDto)
  listReleases(@Query() query: PlatformReleasesQueryDto): Promise<ReleasesPage> {
    return this.releases.list(query);
  }

  /** Full detail (body + initialInput) of ANY release by surrogate id — GLOBAL,
   *  no assignment gate (ADR 0067), so the operator can inspect a release its own
   *  org is not assigned (the tenant `GET /v1/releases/:id` would 404 it). 404
   *  only when the id does not exist. Declared after `releases` (exact) — no
   *  collision; the `:id` uuid never matches the literal segment. */
  @Get("releases/:id")
  @ZodSerializerDto(PlatformReleaseDto)
  getRelease(@Param("id", ParseUUIDPipe) id: string): Promise<ReleaseDetail> {
    return this.releases.getGlobal(id);
  }

  /** Every catalog version (summaries) — the editor's catalog-version picker, so
   *  the operator selects a PUBLISHED version instead of typing a raw number
   *  (ADR 0068 Phase 2). Platform tier (an org-less operator would 403 on the
   *  `RolesGuard`-gated tenant list). Declared before the `:id` detail route. */
  @Get("catalog-versions")
  @ZodSerializerDto(PlatformCatalogVersionsPageDto)
  listCatalogVersions(
    @Query() query: PlatformCatalogVersionsQueryDto,
  ): Promise<CatalogVersionsPage> {
    return this.catalogVersions.list(query);
  }

  /** Full detail (body) of ANY catalog version by surrogate id — the catalog
   *  options behind the release editor's catalog-aware pickers (ADR 0068 Phase 2).
   *  Catalog versions are GLOBAL + immutable (no per-org gate), so this reuses the
   *  same load as the tenant route; it exists at the platform tier so an org-less
   *  operator — who would 403 on the `RolesGuard`-gated `GET /v1/catalog-versions/:id`
   *  — can still load options while authoring. 404 only when the id does not exist. */
  @Get("catalog-versions/:id")
  @ZodSerializerDto(PlatformCatalogVersionDto)
  getCatalogVersion(@Param("id", ParseUUIDPipe) id: string): Promise<CatalogVersionDetail> {
    return this.catalogVersions.get(id);
  }

  /** Broadcast a published release to EVERY org currently on an OLDER version of
   *  its model (CORE_SPEC §3 vendor fan-out, the ADR 0064-deferred half): one
   *  action makes the new version available to all orgs behind, each getting an
   *  opt-in upgrade offer. NEVER moves a pin. Idempotent (a re-broadcast reports
   *  already-assigned orgs as skipped). 404/409 on an unknown/unpublished release
   *  (before any write). `releaseId` is the natural key (path-encoded by the web). */
  @Post("releases/:releaseId/broadcast")
  @ZodSerializerDto(BroadcastAssignResultDto)
  broadcast(
    @CurrentSession() session: SessionContext,
    @Param("releaseId") releaseId: string,
  ): Promise<BroadcastAssignResult> {
    return this.releases.broadcastAssign(session.user.id, releaseId);
  }

  /** Retire a published release (CORE_SPEC §3 `published`→`retired`, ADR 0067):
   *  it stops being OFFERED for new work (not assignable/broadcastable/pinnable,
   *  dropped as an upgrade target) but is NEVER deleted — orgs already pinned to
   *  it keep configuring with it, and quotes stamped on it re-derive forever
   *  (I3). Idempotent (re-retire is a no-op 200). 404 unknown / 409 a non-
   *  published (draft) release. `releaseId` is the natural key (path-encoded). */
  @Post("releases/:releaseId/retire")
  // A state-flip on an existing row (never a creation) — like the `verify`
  // action, 200 for every path (first retire, idempotent re-retire, race re-read).
  @HttpCode(HttpStatus.OK)
  @ZodSerializerDto(PlatformReleaseDto)
  retire(
    @CurrentSession() session: SessionContext,
    @Param("releaseId") releaseId: string,
  ): Promise<ReleaseDetail> {
    return this.releases.retire(session.user.id, releaseId);
  }

  /** Every tenant org (vendor-scale, unpaginated). */
  @Get("organizations")
  @ZodSerializerDto(PlatformOrganizationsDto)
  async listOrganizations(): Promise<PlatformOrganizations> {
    return { items: await this.organizations.listAll() };
  }

  /** The releases one org is currently assigned. */
  @Get("organizations/:orgId/releases")
  @ZodSerializerDto(ReleaseAssignmentsDto)
  listAssignments(@Param("orgId") orgId: string): Promise<ReleaseAssignments> {
    return this.releases.listAssignments(orgId);
  }

  /** Assign a published release to an org. Idempotent; returns the org's updated
   *  assignment set. 404 on an unknown org (before the FK would fire) or release. */
  @Post("organizations/:orgId/releases")
  @ZodSerializerDto(ReleaseAssignmentsDto)
  async assign(
    @CurrentSession() session: SessionContext,
    @Param("orgId") orgId: string,
    @Body() body: AssignReleaseDto,
  ): Promise<ReleaseAssignments> {
    if (!(await this.organizations.exists(orgId))) {
      throw new NotFoundException("Organization not found");
    }
    await this.releases.assign(session.user.id, orgId, body.releaseId);
    return this.releases.listAssignments(orgId);
  }

  /** Unassign a release from an org. A no-op when not assigned; returns the org's
   *  updated assignment set. */
  @Delete("organizations/:orgId/releases/:releaseId")
  @ZodSerializerDto(ReleaseAssignmentsDto)
  async unassign(
    @CurrentSession() session: SessionContext,
    @Param("orgId") orgId: string,
    @Param("releaseId") releaseId: string,
  ): Promise<ReleaseAssignments> {
    await this.releases.unassign(session.user.id, orgId, releaseId);
    return this.releases.listAssignments(orgId);
  }
}
