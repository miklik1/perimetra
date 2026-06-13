/**
 * nestjs-zod DTOs over the shared contracts (`@repo/validators/releases`) — the
 * classes give Nest something to hang pipe/serializer metadata on; the zod
 * schemas stay the single source of truth.
 */
import {
  listReleasesQuerySchema,
  publishReleaseSchema,
  releaseSchema,
  releasesPageSchema,
} from "@repo/validators/releases";

import { createZodDto } from "../../common/api/zod.js";

export class PublishReleaseDto extends createZodDto(publishReleaseSchema) {}
export class ListReleasesQueryDto extends createZodDto(listReleasesQuerySchema) {}

/** Response DTOs — used with `@ZodSerializerDto` (strip semantics, spec §8). */
export class ReleaseDto extends createZodDto(releaseSchema) {}
export class ReleasesPageDto extends createZodDto(releasesPageSchema) {}
