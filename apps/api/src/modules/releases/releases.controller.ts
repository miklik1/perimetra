/**
 * Releases controller (ADR 0053, ADR 0062) — the immutable vendor release store
 * over HTTP. The global SessionGuard (ADR 0099) authenticates every route;
 * @ZodSerializerDto strips
 * responses (spec §8). Append-only surface: list + get + publish, NO update/
 * delete (a published release is immutable, I3).
 *
 * Two authority tiers (ADR 0062). Session auth is global (ADR 0099); each
 * route declares its own tier so the VENDOR tier never depends on org scope:
 *  - GET `/` + GET `/:id` are TENANT routes (`@UseGuards(RolesGuard)`) — an org
 *    sees only the releases ASSIGNED to it (`listForOrg` / assigned-scoped get),
 *    closing the "all published visible to every org" interim leak.
 *  - `publish` is VENDOR-only (`@UseGuards(PlatformGuard)`, NO RolesGuard) —
 *    authoring is the platform operator's, permanently (CORE_SPEC §3), and is
 *    ORTHOGONAL to org membership: an org-less operator must still publish, so
 *    RolesGuard (which 403s an org-less/role-less session) must NOT gate it. Same
 *    tiering as `PlatformController`. Was the org `@RequireRole('admin')`.
 */
import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";

import {
  type ReleaseDetail,
  type ReleasesPage,
  type UpgradeOffers,
} from "@repo/validators/releases";

import { ZodSerializerDto } from "../../common/api/zod.js";
import { Idempotent } from "../../common/idempotency/idempotent.decorator.js";
import { RequireRole } from "../../common/rbac/require-role.decorator.js";
import { CurrentScope } from "../../common/tenancy/current-scope.decorator.js";
import { type RequestScope } from "../../common/tenancy/request-scope.js";
import { PlatformGuard } from "../auth/platform.guard.js";
import { RolesGuard } from "../auth/roles.guard.js";
import {
  ListReleasesQueryDto,
  PinVersionDto,
  PublishReleaseDto,
  ReleaseDto,
  ReleasesPageDto,
  UpgradeOffersDto,
} from "./releases.dto.js";
import { ReleasesService } from "./releases.service.js";

@Controller("releases")
export class ReleasesController {
  constructor(private readonly releases: ReleasesService) {}

  /** Tenant-scoped: only releases assigned to the caller's org (ADR 0062). */
  @Get()
  @UseGuards(RolesGuard)
  @ZodSerializerDto(ReleasesPageDto)
  list(
    @CurrentScope() scope: RequestScope,
    @Query() query: ListReleasesQueryDto,
  ): Promise<ReleasesPage> {
    return this.releases.listForOrg(scope, query);
  }

  /** Publishing an immutable release is VENDOR-only (`PlatformGuard`, ADR 0062 —
   *  authoring is the platform operator's, §3). `RolesGuard` (class) still
   *  resolves the org role; `PlatformGuard` adds the platform requirement. */
  @Post()
  @UseGuards(PlatformGuard)
  @Idempotent()
  @ZodSerializerDto(ReleaseDto)
  publish(
    @CurrentScope() scope: RequestScope,
    @Body() body: PublishReleaseDto,
  ): Promise<ReleaseDetail> {
    return this.releases.publish(scope, body);
  }

  /** The models the caller's org has an available opt-in upgrade for (ADR 0064).
   *  Tenant-scoped; declared BEFORE `:id` so "upgrades" is not parsed as an id. */
  @Get("upgrades")
  @UseGuards(RolesGuard)
  @ZodSerializerDto(UpgradeOffersDto)
  upgrades(@CurrentScope() scope: RequestScope): Promise<UpgradeOffers> {
    return this.releases.getUpgradeOffers(scope);
  }

  /** Opt into a version (CORE_SPEC §3): move the org's active pin for that
   *  release's model. Admin-only (a catalog-config decision, like price tables);
   *  the server is the authority, the `/admin` UI mirrors the role. */
  @Post("pin")
  @UseGuards(RolesGuard)
  @RequireRole("admin")
  @ZodSerializerDto(UpgradeOffersDto)
  pin(@CurrentScope() scope: RequestScope, @Body() body: PinVersionDto): Promise<UpgradeOffers> {
    return this.releases.pinVersion(scope, body);
  }

  /** Detail by surrogate id — tenant-scoped (404 unless assigned to the caller's
   *  org), so a tenant reads only bodies it can see (ADR 0062). */
  @Get(":id")
  @UseGuards(RolesGuard)
  @ZodSerializerDto(ReleaseDto)
  get(
    @CurrentScope() scope: RequestScope,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<ReleaseDetail> {
    return this.releases.get(scope, id);
  }
}
