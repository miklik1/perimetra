/**
 * Quotes controller (ADR 0053). The global SessionGuard (ADR 0099)
 * authenticates; @ZodSerializerDto
 * strips responses (spec §8). `issue` freezes a quote from a site + roster;
 * `:id/verify` runs the I3 reproducibility check; `:id/production` is the
 * workshop's build view (CAR-24, ADR 0101). Append-only surface (no
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

import {
  type QuoteDetail,
  type QuoteProduction,
  type QuoteReproduction,
  type QuotesPage,
} from "@repo/validators/quotes";

import { ZodSerializerDto } from "../../common/api/zod.js";
import { Idempotent } from "../../common/idempotency/idempotent.decorator.js";
import { CurrentRole } from "../../common/rbac/current-role.decorator.js";
import { type OrgRole } from "../../common/rbac/org-role.js";
import { RequireRole } from "../../common/rbac/require-role.decorator.js";
import { CurrentScope } from "../../common/tenancy/current-scope.decorator.js";
import { type RequestScope } from "../../common/tenancy/request-scope.js";
import { RolesGuard } from "../auth/roles.guard.js";
import {
  IssueQuoteDto,
  ListQuotesQueryDto,
  QuoteDto,
  QuoteProductionDto,
  QuoteReproductionDto,
  QuotesPageDto,
} from "./quotes.dto.js";
import { QuotesService } from "./quotes.service.js";

@Controller("quotes")
@UseGuards(RolesGuard)
export class QuotesController {
  constructor(private readonly quotes: QuotesService) {}

  @Get()
  @ZodSerializerDto(QuotesPageDto)
  list(
    @CurrentScope() scope: RequestScope,
    @CurrentRole() role: OrgRole,
    @Query() query: ListQuotesQueryDto,
  ): Promise<QuotesPage> {
    return this.quotes.list(scope, role, query);
  }

  /** Issuing is a commercial action — sales + admin only; workshop is 403. */
  @Post()
  @RequireRole("admin", "sales")
  @Idempotent()
  @ZodSerializerDto(QuoteDto)
  issue(
    @CurrentScope() scope: RequestScope,
    @CurrentRole() role: OrgRole,
    @Body() body: IssueQuoteDto,
  ): Promise<QuoteDetail> {
    return this.quotes.issue(scope, role, body);
  }

  @Get(":id")
  @ZodSerializerDto(QuoteDto)
  get(
    @CurrentScope() scope: RequestScope,
    @CurrentRole() role: OrgRole,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<QuoteDetail> {
    return this.quotes.get(scope, role, id);
  }

  /**
   * Revise a quote (ADR-O1, CAR-158) — issue a new re-derived snapshot and
   * supersede this one in the same tx. Commercial action (sales + admin); the
   * body is the same shape as issue.
   */
  @Post(":id/revise")
  @RequireRole("admin", "sales")
  @Idempotent()
  @ZodSerializerDto(QuoteDto)
  revise(
    @CurrentScope() scope: RequestScope,
    @CurrentRole() role: OrgRole,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: IssueQuoteDto,
  ): Promise<QuoteDetail> {
    return this.quotes.revise(scope, role, id, body);
  }

  /**
   * The workshop PRODUCTION view (CAR-24): cut list + BOM quantities + 2D
   * drawings off the frozen snapshot, never re-derived (I3). No `@RequireRole`
   * — admin/sales/workshop all reach it (same as `get`); the response shape
   * itself is role-INDEPENDENT (always price-blind — production is a surface,
   * not a permission level). A draft/declined/expired quote 404s (nothing to
   * build), same absence-not-403 style as the org-scope isolation guard.
   */
  @Get(":id/production")
  @ZodSerializerDto(QuoteProductionDto)
  production(
    @CurrentScope() scope: RequestScope,
    @CurrentRole() role: OrgRole,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<QuoteProduction> {
    return this.quotes.getProduction(scope, role, id);
  }

  /** I3 acceptance — re-derive from stamps and compare to the frozen snapshot. */
  @Post(":id/verify")
  @HttpCode(HttpStatus.OK)
  @ZodSerializerDto(QuoteReproductionDto)
  verify(
    @CurrentScope() scope: RequestScope,
    @CurrentRole() role: OrgRole,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<QuoteReproduction> {
    return this.quotes.verifyReproducibility(scope, role, id);
  }
}
