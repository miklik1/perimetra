/**
 * nestjs-zod DTOs over the shared contracts (`@repo/validators/quotes`).
 */
import { ledgerRebuildResultSchema } from "@repo/validators/ledger";
import {
  issueQuoteSchema,
  listQuotesQuerySchema,
  quoteAcceptanceSchema,
  quoteProductionSchema,
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
/** Workshop PRODUCTION view (CAR-24) — cut list/BOM-quantities/drawings off the
 *  frozen snapshot; role-independent, always price-blind (ADR 0039 strip
 *  semantics enforced by the schema shape itself, not passthrough). */
export class QuoteProductionDto extends createZodDto(quoteProductionSchema) {}
/** Buyer-facing public nabídka (ADR 0089) — the document + status + validUntil;
 *  strip semantics keep the snapshot's cost/stamps/seeds off the wire. */
export class SharedNabidkaDto extends createZodDto(sharedNabidkaSchema) {}
/** Result of the deviation-ledger rebuild (ADR-O4) — the count re-projected. */
export class LedgerRebuildResultDto extends createZodDto(ledgerRebuildResultSchema) {}
