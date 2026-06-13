/**
 * nestjs-zod DTOs over the shared contracts (`@repo/validators/projects`) —
 * the classes give Nest something to hang pipe/serializer metadata (and,
 * later, OpenAPI) on; the zod schemas stay the single source of truth.
 */
import {
  createProjectSchema,
  listProjectsQuerySchema,
  projectSchema,
  projectSiteSchema,
  projectsPageSchema,
  saveProjectSiteSchema,
  updateProjectSchema,
} from "@repo/validators/projects";

import { createZodDto } from "../../common/api/zod.js";

export class CreateProjectDto extends createZodDto(createProjectSchema) {}
export class UpdateProjectDto extends createZodDto(updateProjectSchema) {}
export class ListProjectsQueryDto extends createZodDto(listProjectsQuerySchema) {}
export class SaveProjectSiteDto extends createZodDto(saveProjectSiteSchema) {}

/** Response DTOs — used with `@ZodSerializerDto` (strip semantics, spec §8). */
export class ProjectDto extends createZodDto(projectSchema) {}
export class ProjectsPageDto extends createZodDto(projectsPageSchema) {}
export class ProjectSiteDto extends createZodDto(projectSiteSchema) {}
