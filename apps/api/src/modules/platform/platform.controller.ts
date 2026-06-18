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
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";

import {
  type BroadcastAssignResult,
  type PlatformOrganizations,
  type ReleaseAssignments,
} from "@repo/validators/platform";
import { type ReleasesPage } from "@repo/validators/releases";

import { ZodSerializerDto } from "../../common/api/zod.js";
import { CurrentSession } from "../auth/current-session.decorator.js";
import { OrganizationsService } from "../auth/organizations.service.js";
import { PlatformGuard } from "../auth/platform.guard.js";
import { SessionGuard, type SessionContext } from "../auth/session.guard.js";
import { ReleasesService } from "../releases/releases.service.js";
import {
  AssignReleaseDto,
  BroadcastAssignResultDto,
  PlatformOrganizationsDto,
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
  ) {}

  /** Every published release — the vendor's assignment picker (global, ADR 0062). */
  @Get("releases")
  @ZodSerializerDto(PlatformReleasesPageDto)
  listReleases(@Query() query: PlatformReleasesQueryDto): Promise<ReleasesPage> {
    return this.releases.list(query);
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
