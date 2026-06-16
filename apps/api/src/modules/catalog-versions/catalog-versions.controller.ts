/**
 * Catalog-versions controller (ADR 0053) — the immutable vendor catalog store
 * over HTTP. SessionGuard authenticates every route; @ZodSerializerDto strips
 * responses (spec §8). Append-only surface: list + get + publish, NO update/
 * delete (a published catalog version is immutable, I3). `publish` is admin-only
 * (`@RequireRole('admin')`, ADR 0056).
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
import { RequireRole } from "../../common/rbac/require-role.decorator.js";
import { CurrentScope } from "../../common/tenancy/current-scope.decorator.js";
import { type RequestScope } from "../../common/tenancy/request-scope.js";
import { RolesGuard } from "../auth/roles.guard.js";
import { SessionGuard } from "../auth/session.guard.js";
import {
  CatalogVersionDto,
  CatalogVersionsPageDto,
  ListCatalogVersionsQueryDto,
  PublishCatalogVersionDto,
} from "./catalog-versions.dto.js";
import { CatalogVersionsService } from "./catalog-versions.service.js";

@Controller("catalog-versions")
@UseGuards(SessionGuard, RolesGuard)
export class CatalogVersionsController {
  constructor(private readonly catalogVersions: CatalogVersionsService) {}

  @Get()
  @ZodSerializerDto(CatalogVersionsPageDto)
  list(@Query() query: ListCatalogVersionsQueryDto): Promise<CatalogVersionsPage> {
    return this.catalogVersions.list(query);
  }

  /** Publishing an immutable catalog version is an admin-only gate (ADR 0056). */
  @Post()
  @RequireRole("admin")
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
  @ZodSerializerDto(CatalogVersionDto)
  getByVersion(@Param("version", ParseIntPipe) version: number): Promise<CatalogVersionDetail> {
    return this.catalogVersions.getByVersion(version);
  }

  @Get(":id")
  @ZodSerializerDto(CatalogVersionDto)
  get(@Param("id", ParseUUIDPipe) id: string): Promise<CatalogVersionDetail> {
    return this.catalogVersions.get(id);
  }
}
