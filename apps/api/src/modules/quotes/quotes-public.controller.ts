/**
 * Public buyer surface (ADR 0083, re-carried by ADR 0130) — the shareToken
 * read/accept/decline path. `@Public()`: the buyer has no account; the
 * unguessable `shareToken` (a random UUID) IS the bearer credential (opts out of
 * the global default-deny SessionGuard, ADR 0099). The global ThrottlerGuard
 * still applies; `@Throttle` tightens it further against token-guessing.
 * Responses are stripped — the resolve read returns the built document with no
 * cost/stamps/seeds, and accept/decline return a minimal acknowledgement
 * (document number + new status), never the priced snapshot.
 *
 * EVERY handler here is a POST that takes the token in the BODY, and none takes
 * it as a route parameter (ADR 0130). That is the whole point of the class: a
 * URL is copied into places a body is not — `pino-http` logs `req.url` but never
 * the body, every reverse proxy access-logs the request line, and the telemetry
 * URL primitive deliberately keeps the pathname, so a token in a path segment is
 * reduced but never redacted on its way to Sentry and PostHog (skeleton ADR
 * 1030). `resolve` is a pure read with no state change, so like the ARES/VIES
 * lookups it returns 200 rather than the POST-default 201.
 *
 * Class-level `@Public()` means every FUTURE handler added here ships anonymous
 * — only shareToken-credentialed routes belong in this class, and each of them
 * must carry the token in the body for the reason above.
 */
import { Body, Controller, HttpCode, HttpStatus, Post } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";

import { type QuoteAcceptance, type SharedNabidka } from "@repo/validators/quotes";

import { ZodSerializerDto } from "../../common/api/zod.js";
import { Public } from "../auth/public.decorator.js";
import { QuoteAcceptanceDto, ResolveSharedNabidkaDto, SharedNabidkaDto } from "./quotes.dto.js";
import { QuotesService } from "./quotes.service.js";

@Controller("quotes/shared")
@Public()
// Tight ceiling — the token is unguessable, but cap blind attempts hard. The
// budget is shared by resolve/accept/decline, exactly as it was when the read
// was a GET: a buyer opens the link once and clicks once.
@Throttle({ default: { ttl: 60_000, limit: 10 } })
export class QuotesPublicController {
  constructor(private readonly quotes: QuotesService) {}

  /**
   * Buyer-facing read of the nabídka by shareToken (ADR 0089/0130). No
   * SessionGuard — the token is the credential; inherits the class throttle
   * (10/min). Returns the server-built `NabidkaDocument` + effective status,
   * never the cost/stamps. An unknown token 404s through the same path as a
   * withdrawn one — never an existence oracle.
   */
  @Post("resolve")
  @HttpCode(HttpStatus.OK)
  @ZodSerializerDto(SharedNabidkaDto)
  resolve(@Body() body: ResolveSharedNabidkaDto): Promise<SharedNabidka> {
    return this.quotes.getSharedNabidka(body.token);
  }

  @Post("accept")
  @HttpCode(HttpStatus.OK)
  @ZodSerializerDto(QuoteAcceptanceDto)
  accept(@Body() body: ResolveSharedNabidkaDto): Promise<QuoteAcceptance> {
    return this.quotes.acceptByShareToken(body.token);
  }

  @Post("decline")
  @HttpCode(HttpStatus.OK)
  @ZodSerializerDto(QuoteAcceptanceDto)
  decline(@Body() body: ResolveSharedNabidkaDto): Promise<QuoteAcceptance> {
    return this.quotes.declineByShareToken(body.token);
  }
}
