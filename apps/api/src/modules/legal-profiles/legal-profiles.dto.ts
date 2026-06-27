/**
 * nestjs-zod DTOs over the shared contracts (`@repo/validators/legal-profiles`) —
 * the classes give Nest something to hang pipe/serializer metadata on; the zod
 * schemas stay the single source of truth.
 */
import {
  legalProfileResponseSchema,
  legalProfileSchema,
  upsertLegalProfileSchema,
} from "@repo/validators/legal-profiles";

import { createZodDto } from "../../common/api/zod.js";

export class UpsertLegalProfileDto extends createZodDto(upsertLegalProfileSchema) {}

/** Response DTOs — used with `@ZodSerializerDto` (strip semantics, spec §8). */
export class LegalProfileDto extends createZodDto(legalProfileSchema) {}
export class LegalProfileResponseDto extends createZodDto(legalProfileResponseSchema) {}
