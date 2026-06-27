/**
 * nestjs-zod DTOs for the registry-lookup responses (ADR 0090). The zod schemas
 * (`@repo/validators/lookups`) stay the single source of truth; these classes
 * back `@ZodSerializerDto` (strip semantics, spec §8) — so a `not_found`/
 * `unavailable` result can only ever serialize the matched discriminated member,
 * never leak subject data the upstream returned.
 */
import {
  aresLookupRequestSchema,
  aresLookupSchema,
  viesLookupRequestSchema,
  viesLookupSchema,
} from "@repo/validators/lookups";

import { createZodDto } from "../../common/api/zod.js";

/** Request bodies — the lookup key (IČO/DIČ) travels here, not in the URL. */
export class AresLookupRequestDto extends createZodDto(aresLookupRequestSchema) {}
export class ViesLookupRequestDto extends createZodDto(viesLookupRequestSchema) {}

/** Responses — strip semantics (spec §8); a degraded status carries no subject data. */
export class AresLookupDto extends createZodDto(aresLookupSchema) {}
export class ViesLookupDto extends createZodDto(viesLookupSchema) {}
