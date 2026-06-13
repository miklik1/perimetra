/**
 * nestjs-zod DTOs over the shared contracts (`@repo/validators/price-tables`).
 */
import {
  activePriceTableQuerySchema,
  listPriceTablesQuerySchema,
  priceTableSchema,
  priceTablesPageSchema,
  publishPriceTableSchema,
} from "@repo/validators/price-tables";

import { createZodDto } from "../../common/api/zod.js";

export class PublishPriceTableDto extends createZodDto(publishPriceTableSchema) {}
export class ListPriceTablesQueryDto extends createZodDto(listPriceTablesQuerySchema) {}
export class ActivePriceTableQueryDto extends createZodDto(activePriceTableQuerySchema) {}

/** Response DTOs — used with `@ZodSerializerDto` (strip semantics, spec §8). */
export class PriceTableDto extends createZodDto(priceTableSchema) {}
export class PriceTablesPageDto extends createZodDto(priceTablesPageSchema) {}
