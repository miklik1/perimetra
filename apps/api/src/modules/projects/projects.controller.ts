/**
 * Reference controller (spec §7.8). Conventions on display:
 * - SessionGuard on the class — every route authenticated.
 * - nestjs-zod (via `common/api/zod.ts`): the global `APP_PIPE` parses and
 *   coerces inputs against the DTOs (422 envelope on failure);
 *   `@ZodSerializerDto` validates + STRIPS every response (an unvalidated
 *   drizzle select shipping internals is the leak class this kills, spec §8).
 * - `@Idempotent()` on the unsafe create — replays return the cached
 *   response (Idempotency-Key header, spec §8).
 * - Ownership 404s (not 403s) come from the service: same shape whether the
 *   project is missing or someone else's.
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

import { type Project, type ProjectsPage } from "@repo/validators/projects";

import { ZodSerializerDto } from "../../common/api/zod.js";
import { Idempotent } from "../../common/idempotency/idempotent.decorator.js";
import { CurrentScope } from "../../common/tenancy/current-scope.decorator.js";
import { type RequestScope } from "../../common/tenancy/request-scope.js";
import { SessionGuard } from "../auth/session.guard.js";
import {
  CreateProjectDto,
  ListProjectsQueryDto,
  ProjectDto,
  ProjectsPageDto,
  UpdateProjectDto,
} from "./projects.dto.js";
import { ProjectsService } from "./projects.service.js";

@Controller("projects")
@UseGuards(SessionGuard)
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  @ZodSerializerDto(ProjectsPageDto)
  list(
    @CurrentScope() scope: RequestScope,
    @Query() query: ListProjectsQueryDto,
  ): Promise<ProjectsPage> {
    return this.projects.list(scope, query);
  }

  @Post()
  @Idempotent()
  @ZodSerializerDto(ProjectDto)
  create(@CurrentScope() scope: RequestScope, @Body() body: CreateProjectDto): Promise<Project> {
    return this.projects.create(scope, body);
  }

  @Get(":id")
  @ZodSerializerDto(ProjectDto)
  get(
    @CurrentScope() scope: RequestScope,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<Project> {
    return this.projects.get(scope, id);
  }

  @Patch(":id")
  @ZodSerializerDto(ProjectDto)
  update(
    @CurrentScope() scope: RequestScope,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: UpdateProjectDto,
  ): Promise<Project> {
    return this.projects.update(scope, id, body);
  }

  @Post(":id/archive")
  @HttpCode(HttpStatus.OK)
  @ZodSerializerDto(ProjectDto)
  archive(
    @CurrentScope() scope: RequestScope,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<Project> {
    return this.projects.archive(scope, id);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentScope() scope: RequestScope,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<void> {
    // 204 — the one route without a response DTO (there is no body to strip).
    return this.projects.softDelete(scope, id);
  }
}
