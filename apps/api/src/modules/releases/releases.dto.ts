/**
 * nestjs-zod DTOs over the shared contracts (`@repo/validators/releases`) — the
 * classes give Nest something to hang pipe/serializer metadata on; the zod
 * schemas stay the single source of truth.
 */
import {
  listReleasesQuerySchema,
  pinVersionSchema,
  publishReleaseSchema,
  releaseSchema,
  releasesPageSchema,
  upgradeOffersSchema,
} from "@repo/validators/releases";

import { createZodDto } from "../../common/api/zod.js";

export class PublishReleaseDto extends createZodDto(publishReleaseSchema) {}
export class ListReleasesQueryDto extends createZodDto(listReleasesQuerySchema) {}
export class PinVersionDto extends createZodDto(pinVersionSchema) {}

/** Response DTOs — used with `@ZodSerializerDto` (strip semantics, spec §8). */
export class ReleaseDto extends createZodDto(releaseSchema) {}
export class ReleasesPageDto extends createZodDto(releasesPageSchema) {}
export class UpgradeOffersDto extends createZodDto(upgradeOffersSchema) {}
