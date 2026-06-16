/**
 * Releases controller (ADR 0053) — the immutable vendor release store over
 * HTTP. SessionGuard authenticates every route; @ZodSerializerDto strips
 * responses (spec §8). Append-only surface: list + get + publish, NO update/
 * delete (a published release is immutable, I3). `publish` is admin-only
 * (`@RequireRole('admin')`, ADR 0056).
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

import { type ReleaseDetail, type ReleasesPage } from "@repo/validators/releases";

import { ZodSerializerDto } from "../../common/api/zod.js";
import { Idempotent } from "../../common/idempotency/idempotent.decorator.js";
import { RequireRole } from "../../common/rbac/require-role.decorator.js";
import { CurrentScope } from "../../common/tenancy/current-scope.decorator.js";
import { type RequestScope } from "../../common/tenancy/request-scope.js";
import { RolesGuard } from "../auth/roles.guard.js";
import { SessionGuard } from "../auth/session.guard.js";
import {
  ListReleasesQueryDto,
  PublishReleaseDto,
  ReleaseDto,
  ReleasesPageDto,
} from "./releases.dto.js";
import { ReleasesService } from "./releases.service.js";

@Controller("releases")
@UseGuards(SessionGuard, RolesGuard)
export class ReleasesController {
  constructor(private readonly releases: ReleasesService) {}

  @Get()
  @ZodSerializerDto(ReleasesPageDto)
  list(@Query() query: ListReleasesQueryDto): Promise<ReleasesPage> {
    return this.releases.list(query);
  }

  /** Publishing an immutable release is an admin-only gate (ADR 0056 — closes
   *  the slot-poisoning hole the authenticated-only surface left open). */
  @Post()
  @RequireRole("admin")
  @Idempotent()
  @ZodSerializerDto(ReleaseDto)
  publish(
    @CurrentScope() scope: RequestScope,
    @Body() body: PublishReleaseDto,
  ): Promise<ReleaseDetail> {
    return this.releases.publish(scope, body);
  }

  @Get(":id")
  @ZodSerializerDto(ReleaseDto)
  get(@Param("id", ParseUUIDPipe) id: string): Promise<ReleaseDetail> {
    return this.releases.get(id);
  }
}
