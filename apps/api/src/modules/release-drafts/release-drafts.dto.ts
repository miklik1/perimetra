/**
 * nestjs-zod DTOs over the shared contracts (`@repo/validators/release-drafts`) —
 * the classes give Nest something to hang pipe/serializer metadata (and,
 * later, OpenAPI) on; the zod schemas stay the single source of truth.
 */
import {
  createReleaseDraftSchema,
  listReleaseDraftsQuerySchema,
  releaseDraftSchema,
  releaseDraftsPageSchema,
  updateReleaseDraftSchema,
} from "@repo/validators/release-drafts";

import { createZodDto } from "../../common/api/zod.js";

export class CreateReleaseDraftDto extends createZodDto(createReleaseDraftSchema) {}
export class UpdateReleaseDraftDto extends createZodDto(updateReleaseDraftSchema) {}
export class ListReleaseDraftsQueryDto extends createZodDto(listReleaseDraftsQuerySchema) {}

/** Response DTOs — used with `@ZodSerializerDto` (strip semantics, spec §8). */
export class ReleaseDraftDto extends createZodDto(releaseDraftSchema) {}
export class ReleaseDraftsPageDto extends createZodDto(releaseDraftsPageSchema) {}
