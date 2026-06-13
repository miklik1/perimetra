/**
 * nestjs-zod DTOs over the shared contracts (`@repo/validators/quotes`).
 */
import {
  issueQuoteSchema,
  listQuotesQuerySchema,
  quoteReproductionSchema,
  quoteSchema,
  quotesPageSchema,
} from "@repo/validators/quotes";

import { createZodDto } from "../../common/api/zod.js";

export class IssueQuoteDto extends createZodDto(issueQuoteSchema) {}
export class ListQuotesQueryDto extends createZodDto(listQuotesQuerySchema) {}

/** Response DTOs — used with `@ZodSerializerDto` (strip semantics, spec §8). */
export class QuoteDto extends createZodDto(quoteSchema) {}
export class QuotesPageDto extends createZodDto(quotesPageSchema) {}
export class QuoteReproductionDto extends createZodDto(quoteReproductionSchema) {}
