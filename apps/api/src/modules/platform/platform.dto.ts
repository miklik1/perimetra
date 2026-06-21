/**
 * nestjs-zod DTOs for the platform/vendor console (ADR 0062). The publish picker
 * reuses the release list contracts; only the assignment + org-list shapes are
 * platform-specific. The zod schemas (`@repo/validators/{platform,releases}`)
 * stay the single source of truth.
 */
import {
  catalogVersionSchema,
  catalogVersionsPageSchema,
  listCatalogVersionsQuerySchema,
} from "@repo/validators/catalog-versions";
import {
  assignReleaseSchema,
  broadcastAssignResultSchema,
  platformOrganizationsSchema,
  releaseAssignmentsSchema,
} from "@repo/validators/platform";
import {
  listReleasesQuerySchema,
  releaseSchema,
  releasesPageSchema,
} from "@repo/validators/releases";

import { createZodDto } from "../../common/api/zod.js";

export class PlatformReleasesQueryDto extends createZodDto(listReleasesQuerySchema) {}
export class AssignReleaseDto extends createZodDto(assignReleaseSchema) {}

/** Response DTOs — used with `@ZodSerializerDto` (strip semantics, spec §8). */
export class PlatformReleasesPageDto extends createZodDto(releasesPageSchema) {}
export class PlatformOrganizationsDto extends createZodDto(platformOrganizationsSchema) {}
export class ReleaseAssignmentsDto extends createZodDto(releaseAssignmentsSchema) {}
export class BroadcastAssignResultDto extends createZodDto(broadcastAssignResultSchema) {}
/** Full release detail (body + initialInput) for the vendor console — the
 *  GLOBAL detail read + the retire response (ADR 0067). */
export class PlatformReleaseDto extends createZodDto(releaseSchema) {}
/** Full catalog-version detail (body) for the vendor console — the GLOBAL detail
 *  read backing the release editor's catalog-aware pickers (ADR 0068 Phase 2). */
export class PlatformCatalogVersionDto extends createZodDto(catalogVersionSchema) {}
/** Catalog-version list (summaries) — the editor's catalog-version picker; the
 *  operator selects a PUBLISHED version rather than typing a number (ADR 0068 Phase 2). */
export class PlatformCatalogVersionsQueryDto extends createZodDto(listCatalogVersionsQuerySchema) {}
export class PlatformCatalogVersionsPageDto extends createZodDto(catalogVersionsPageSchema) {}
