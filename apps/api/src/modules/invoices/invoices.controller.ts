/**
 * Invoices controller (ADR 0112) — the §29 daňový-doklad surface. Conventions:
 * - The global SessionGuard (APP_GUARD, ADR 0099) authenticates every route;
 *   the class `RolesGuard` (ADR 0056) resolves the caller's org role.
 * - Every route is `@RequireRole(...)`-gated to admin/sales — an invoice is
 *   PRICE-BEARING, so workshop is price-blind by ABSENCE (403), not by a
 *   stripped projection. Payment transitions are admin-only.
 * - `@ZodSerializerDto` validates + STRIPS every response (spec §8).
 * - `@Idempotent()` on the issue POST — a replay returns the cached response
 *   rather than burning a second číselná-řada number.
 * - Ownership/existence 404s come from the service (same shape either way).
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
  type Invoice,
  type InvoiceReproduction,
  type InvoicesPage,
} from "@repo/validators/invoices";

import { ZodSerializerDto } from "../../common/api/zod.js";
import { Idempotent } from "../../common/idempotency/idempotent.decorator.js";
import { RequireRole } from "../../common/rbac/require-role.decorator.js";
import { CurrentScope } from "../../common/tenancy/current-scope.decorator.js";
import { type RequestScope } from "../../common/tenancy/request-scope.js";
import { RolesGuard } from "../auth/roles.guard.js";
import {
  InvoiceDto,
  InvoiceReproductionDto,
  InvoicesPageDto,
  IssueInvoiceDto,
  ListInvoicesQueryDto,
  MarkInvoicePaidDto,
} from "./invoices.dto.js";
import { InvoicesService } from "./invoices.service.js";

@Controller("invoices")
@UseGuards(RolesGuard)
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get()
  @RequireRole("admin", "sales")
  @ZodSerializerDto(InvoicesPageDto)
  list(
    @CurrentScope() scope: RequestScope,
    @Query() query: ListInvoicesQueryDto,
  ): Promise<InvoicesPage> {
    return this.invoices.list(scope, query);
  }

  /** Issue a §29 daňový doklad from an order — admin + sales. */
  @Post()
  @RequireRole("admin", "sales")
  @Idempotent()
  @ZodSerializerDto(InvoiceDto)
  issue(@CurrentScope() scope: RequestScope, @Body() body: IssueInvoiceDto): Promise<Invoice> {
    return this.invoices.issue(scope, body);
  }

  @Get(":id")
  @RequireRole("admin", "sales")
  @ZodSerializerDto(InvoiceDto)
  get(
    @CurrentScope() scope: RequestScope,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<Invoice> {
    return this.invoices.get(scope, id);
  }

  /** Mark an issued invoice paid — admin only, idempotent (409 on repeat). */
  @Post(":id/mark-paid")
  @HttpCode(HttpStatus.OK)
  @RequireRole("admin")
  @ZodSerializerDto(InvoiceDto)
  markPaid(
    @CurrentScope() scope: RequestScope,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: MarkInvoicePaidDto,
  ): Promise<Invoice> {
    return this.invoices.markPaid(scope, id, body);
  }

  /** Reverse a mark-paid — admin only, idempotent (409 when not paid). */
  @Post(":id/unmark-paid")
  @HttpCode(HttpStatus.OK)
  @RequireRole("admin")
  @ZodSerializerDto(InvoiceDto)
  unmarkPaid(
    @CurrentScope() scope: RequestScope,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<Invoice> {
    return this.invoices.unmarkPaid(scope, id);
  }

  /** I3 reproducibility check — re-derive the frozen snapshot (ADR 0112 §6). */
  @Post(":id/verify")
  @HttpCode(HttpStatus.OK)
  @RequireRole("admin", "sales")
  @ZodSerializerDto(InvoiceReproductionDto)
  verify(
    @CurrentScope() scope: RequestScope,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<InvoiceReproduction> {
    return this.invoices.verifyReproducibility(scope, id);
  }
}
