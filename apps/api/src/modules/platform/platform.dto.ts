/**
 * nestjs-zod DTOs for the platform/vendor console (ADR 0062). The publish picker
 * reuses the release list contracts; only the assignment + org-list shapes are
 * platform-specific. The zod schemas (`@repo/validators/{platform,releases}`)
 * stay the single source of truth.
 */
import {
  assignReleaseSchema,
  platformOrganizationsSchema,
  releaseAssignmentsSchema,
} from "@repo/validators/platform";
import { listReleasesQuerySchema, releasesPageSchema } from "@repo/validators/releases";

import { createZodDto } from "../../common/api/zod.js";

export class PlatformReleasesQueryDto extends createZodDto(listReleasesQuerySchema) {}
export class AssignReleaseDto extends createZodDto(assignReleaseSchema) {}

/** Response DTOs — used with `@ZodSerializerDto` (strip semantics, spec §8). */
export class PlatformReleasesPageDto extends createZodDto(releasesPageSchema) {}
export class PlatformOrganizationsDto extends createZodDto(platformOrganizationsSchema) {}
export class ReleaseAssignmentsDto extends createZodDto(releaseAssignmentsSchema) {}
