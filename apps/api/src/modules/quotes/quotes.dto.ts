/**
 * nestjs-zod DTOs over the shared contracts (`@repo/validators/quotes`).
 */
import {
  issueQuoteSchema,
  listQuotesQuerySchema,
  quoteAcceptanceSchema,
  quoteReproductionSchema,
  quoteSchema,
  quotesPageSchema,
  sharedNabidkaSchema,
} from "@repo/validators/quotes";

import { createZodDto } from "../../common/api/zod.js";

export class IssueQuoteDto extends createZodDto(issueQuoteSchema) {}
export class ListQuotesQueryDto extends createZodDto(listQuotesQuerySchema) {}

/** Response DTOs — used with `@ZodSerializerDto` (strip semantics, spec §8). */
export class QuoteDto extends createZodDto(quoteSchema) {}
export class QuotesPageDto extends createZodDto(quotesPageSchema) {}
export class QuoteReproductionDto extends createZodDto(quoteReproductionSchema) {}
export class QuoteAcceptanceDto extends createZodDto(quoteAcceptanceSchema) {}
/** Buyer-facing public nabídka (ADR 0089) — the document + status + validUntil;
 *  strip semantics keep the snapshot's cost/stamps/seeds off the wire. */
export class SharedNabidkaDto extends createZodDto(sharedNabidkaSchema) {}
