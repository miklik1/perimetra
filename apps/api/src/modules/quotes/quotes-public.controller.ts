/**
 * Public buyer surface (ADR 0083) — the shareToken accept/decline path.
 * `@Public()`: the buyer has no account; the unguessable `shareToken` (a random
 * UUID) IS the bearer credential (opts out of the global default-deny
 * SessionGuard, ADR 0099). The global ThrottlerGuard still applies; `@Throttle`
 * tightens it further against token-guessing. Responses are stripped to a minimal
 * acknowledgement (document number + new status) — never the priced snapshot.
 *
 * Class-level `@Public()` means every FUTURE handler added here ships anonymous
 * — only shareToken-credentialed routes belong in this class.
 */
import { Controller, Get, HttpCode, HttpStatus, Param, Post } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";

import { type QuoteAcceptance, type SharedNabidka } from "@repo/validators/quotes";

import { ZodSerializerDto } from "../../common/api/zod.js";
import { Public } from "../auth/public.decorator.js";
import { QuoteAcceptanceDto, SharedNabidkaDto } from "./quotes.dto.js";
import { QuotesService } from "./quotes.service.js";

@Controller("quotes/shared")
@Public()
// Tight ceiling — the token is unguessable, but cap blind attempts hard.
@Throttle({ default: { ttl: 60_000, limit: 10 } })
export class QuotesPublicController {
  constructor(private readonly quotes: QuotesService) {}

  /**
   * Buyer-facing read of the nabídka by shareToken (ADR 0089). No SessionGuard —
   * the token is the credential; inherits the class throttle (10/min). Returns
   * the server-built `NabidkaDocument` + effective status, never the cost/stamps.
   */
  @Get(":shareToken")
  @ZodSerializerDto(SharedNabidkaDto)
  shared(@Param("shareToken") shareToken: string): Promise<SharedNabidka> {
    return this.quotes.getSharedNabidka(shareToken);
  }

  @Post(":shareToken/accept")
  @HttpCode(HttpStatus.OK)
  @ZodSerializerDto(QuoteAcceptanceDto)
  accept(@Param("shareToken") shareToken: string): Promise<QuoteAcceptance> {
    return this.quotes.acceptByShareToken(shareToken);
  }

  @Post(":shareToken/decline")
  @HttpCode(HttpStatus.OK)
  @ZodSerializerDto(QuoteAcceptanceDto)
  decline(@Param("shareToken") shareToken: string): Promise<QuoteAcceptance> {
    return this.quotes.declineByShareToken(shareToken);
  }
}
