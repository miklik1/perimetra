/**
 * nestjs-zod DTOs over the shared contracts (`@repo/validators/catalog-versions`)
 * — the classes give Nest something to hang pipe/serializer metadata on; the
 * zod schemas stay the single source of truth.
 */
import {
  catalogVersionSchema,
  catalogVersionsPageSchema,
  listCatalogVersionsQuerySchema,
  publishCatalogVersionSchema,
} from "@repo/validators/catalog-versions";

import { createZodDto } from "../../common/api/zod.js";

export class PublishCatalogVersionDto extends createZodDto(publishCatalogVersionSchema) {}
export class ListCatalogVersionsQueryDto extends createZodDto(listCatalogVersionsQuerySchema) {}

/** Response DTOs — used with `@ZodSerializerDto` (strip semantics, spec §8). */
export class CatalogVersionDto extends createZodDto(catalogVersionSchema) {}
export class CatalogVersionsPageDto extends createZodDto(catalogVersionsPageSchema) {}
