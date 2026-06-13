/**
 * Quotes controller (ADR 0053). SessionGuard authenticates; @ZodSerializerDto
 * strips responses (spec §8). `issue` freezes a quote from a site + roster;
 * `:id/verify` runs the I3 reproducibility check. Append-only surface (no
 * update/delete — an issued snapshot is immutable).
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";

import { type QuoteDetail, type QuoteReproduction, type QuotesPage } from "@repo/validators/quotes";

import { ZodSerializerDto } from "../../common/api/zod.js";
import { Idempotent } from "../../common/idempotency/idempotent.decorator.js";
import { CurrentScope } from "../../common/tenancy/current-scope.decorator.js";
import { type RequestScope } from "../../common/tenancy/request-scope.js";
import { SessionGuard } from "../auth/session.guard.js";
import {
  IssueQuoteDto,
  ListQuotesQueryDto,
  QuoteDto,
  QuoteReproductionDto,
  QuotesPageDto,
} from "./quotes.dto.js";
import { QuotesService } from "./quotes.service.js";

@Controller("quotes")
@UseGuards(SessionGuard)
export class QuotesController {
  constructor(private readonly quotes: QuotesService) {}

  @Get()
  @ZodSerializerDto(QuotesPageDto)
  list(
    @CurrentScope() scope: RequestScope,
    @Query() query: ListQuotesQueryDto,
  ): Promise<QuotesPage> {
    return this.quotes.list(scope, query);
  }

  @Post()
  @Idempotent()
  @ZodSerializerDto(QuoteDto)
  issue(@CurrentScope() scope: RequestScope, @Body() body: IssueQuoteDto): Promise<QuoteDetail> {
    return this.quotes.issue(scope, body);
  }

  @Get(":id")
  @ZodSerializerDto(QuoteDto)
  get(
    @CurrentScope() scope: RequestScope,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<QuoteDetail> {
    return this.quotes.get(scope, id);
  }

  /** I3 acceptance — re-derive from stamps and compare to the frozen snapshot. */
  @Post(":id/verify")
  @HttpCode(HttpStatus.OK)
  @ZodSerializerDto(QuoteReproductionDto)
  verify(
    @CurrentScope() scope: RequestScope,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<QuoteReproduction> {
    return this.quotes.verifyReproducibility(scope, id);
  }
}
