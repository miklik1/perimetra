/**
 * ReleaseDrafts controller (ADR 0068 Phase 3) — the MUTABLE author workspace
 * over HTTP, mounted under the platform prefix (`/v1/platform/release-drafts`).
 *
 * VENDOR-only, ORG-scoped (the user's decision + the releases-publish
 * precedent): authoring a release is the platform operator's, ORTHOGONAL to org
 * membership (CORE_SPEC §3, ADR 0062), so the WHOLE class is `PlatformGuard`-
 * gated — never `RolesGuard` (which would 403 an org-less operator and add a
 * pointless member lookup). `@CurrentScope()` still supplies the org key (a
 * vendor TEAM shares its org's drafts) and the author/audit `userId`.
 *
 * Conventions: SessionGuard authenticates; `@ZodSerializerDto` strips every
 * response (spec §8); `@Idempotent()` on create dedupes a retried first-save;
 * ownership 404s (not 403s) come from the service (no existence oracle).
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";

import { type ReleaseDraft, type ReleaseDraftsPage } from "@repo/validators/release-drafts";

import { ZodSerializerDto } from "../../common/api/zod.js";
import { Idempotent } from "../../common/idempotency/idempotent.decorator.js";
import { CurrentScope } from "../../common/tenancy/current-scope.decorator.js";
import { type RequestScope } from "../../common/tenancy/request-scope.js";
import { PlatformGuard } from "../auth/platform.guard.js";
import { SessionGuard } from "../auth/session.guard.js";
import {
  CreateReleaseDraftDto,
  ListReleaseDraftsQueryDto,
  ReleaseDraftDto,
  ReleaseDraftsPageDto,
  UpdateReleaseDraftDto,
} from "./release-drafts.dto.js";
import { ReleaseDraftsService } from "./release-drafts.service.js";

@Controller("platform/release-drafts")
@UseGuards(SessionGuard, PlatformGuard)
export class ReleaseDraftsController {
  constructor(private readonly releaseDrafts: ReleaseDraftsService) {}

  @Get()
  @ZodSerializerDto(ReleaseDraftsPageDto)
  list(
    @CurrentScope() scope: RequestScope,
    @Query() query: ListReleaseDraftsQueryDto,
  ): Promise<ReleaseDraftsPage> {
    return this.releaseDrafts.list(scope, query);
  }

  @Post()
  @Idempotent()
  @ZodSerializerDto(ReleaseDraftDto)
  create(
    @CurrentScope() scope: RequestScope,
    @Body() body: CreateReleaseDraftDto,
  ): Promise<ReleaseDraft> {
    return this.releaseDrafts.create(scope, body);
  }

  @Get(":id")
  @ZodSerializerDto(ReleaseDraftDto)
  get(
    @CurrentScope() scope: RequestScope,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<ReleaseDraft> {
    return this.releaseDrafts.get(scope, id);
  }

  @Patch(":id")
  @ZodSerializerDto(ReleaseDraftDto)
  update(
    @CurrentScope() scope: RequestScope,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: UpdateReleaseDraftDto,
  ): Promise<ReleaseDraft> {
    return this.releaseDrafts.update(scope, id, body);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentScope() scope: RequestScope,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<void> {
    // 204 — the one route without a response DTO (there is no body to strip).
    return this.releaseDrafts.softDelete(scope, id);
  }
}
