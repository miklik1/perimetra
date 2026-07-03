/**
 * Catalog-versions controller (ADR 0053) — the immutable vendor catalog store
 * over HTTP. The global SessionGuard (ADR 0099) authenticates every route;
 * @ZodSerializerDto strips
 * responses (spec §8). Append-only surface: list + get + publish, NO update/
 * delete (a published catalog version is immutable, I3). `publish` is VENDOR-only
 * (`PlatformGuard`, ADR 0062 — authoring is the platform operator's, §3; was the
 * org `@RequireRole('admin')` of ADR 0056).
 */
import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";

import {
  type CatalogVersionDetail,
  type CatalogVersionsPage,
} from "@repo/validators/catalog-versions";

import { ZodSerializerDto } from "../../common/api/zod.js";
import { Idempotent } from "../../common/idempotency/idempotent.decorator.js";
import { CurrentScope } from "../../common/tenancy/current-scope.decorator.js";
import { type RequestScope } from "../../common/tenancy/request-scope.js";
import { PlatformGuard } from "../auth/platform.guard.js";
import { RolesGuard } from "../auth/roles.guard.js";
import {
  CatalogVersionDto,
  CatalogVersionsPageDto,
  ListCatalogVersionsQueryDto,
  PublishCatalogVersionDto,
} from "./catalog-versions.dto.js";
import { CatalogVersionsService } from "./catalog-versions.service.js";

// Session auth is global (ADR 0099); each route declares its tier. Publishing
// is VENDOR-only and must NOT depend on org scope (ADR 0062) — see the publish
// route. Reads stay tenant-gated (RolesGuard).
@Controller("catalog-versions")
export class CatalogVersionsController {
  constructor(private readonly catalogVersions: CatalogVersionsService) {}

  @Get()
  @UseGuards(RolesGuard)
  @ZodSerializerDto(CatalogVersionsPageDto)
  list(@Query() query: ListCatalogVersionsQueryDto): Promise<CatalogVersionsPage> {
    return this.catalogVersions.list(query);
  }

  /** Publishing an immutable catalog version is VENDOR-only — `PlatformGuard`
   *  ONLY, NO RolesGuard: authoring is the platform operator's (CORE_SPEC §3),
   *  orthogonal to org membership, so an org-less operator must still publish
   *  (ADR 0062). `@CurrentScope().userId` (the audit actor) resolves from the
   *  session directly, not from RolesGuard. */
  @Post()
  @UseGuards(PlatformGuard)
  @Idempotent()
  @ZodSerializerDto(CatalogVersionDto)
  publish(
    @CurrentScope() scope: RequestScope,
    @Body() body: PublishCatalogVersionDto,
  ): Promise<CatalogVersionDetail> {
    return this.catalogVersions.publish(scope, body);
  }

  /** Fetch by the natural catalog version number (releases/quotes resolve here). */
  @Get("by-version/:version")
  @UseGuards(RolesGuard)
  @ZodSerializerDto(CatalogVersionDto)
  getByVersion(@Param("version", ParseIntPipe) version: number): Promise<CatalogVersionDetail> {
    return this.catalogVersions.getByVersion(version);
  }

  @Get(":id")
  @UseGuards(RolesGuard)
  @ZodSerializerDto(CatalogVersionDto)
  get(@Param("id", ParseUUIDPipe) id: string): Promise<CatalogVersionDetail> {
    return this.catalogVersions.get(id);
  }
}
