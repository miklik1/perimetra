/**
 * Ledger controller (ADR 0110 / ADR-O4, CAR-159) — the deviation-intelligence
 * read: `GET /v1/ledger?target=&from=&quoteId=` returns the filtered rows + the
 * recurrence report (the vendor ETO→CTO promotion queue). Admin-only: the ledger
 * carries margin-override values (price-bearing), so it is not a workshop
 * surface. Order exceptions are WRITTEN through the orders controller.
 */
import { Controller, Get, Query, UseGuards } from "@nestjs/common";

import { type LedgerPage } from "@repo/validators/ledger";

import { ZodSerializerDto } from "../../common/api/zod.js";
import { RequireRole } from "../../common/rbac/require-role.decorator.js";
import { CurrentScope } from "../../common/tenancy/current-scope.decorator.js";
import { type RequestScope } from "../../common/tenancy/request-scope.js";
import { RolesGuard } from "../auth/roles.guard.js";
import { LedgerPageDto, ListLedgerQueryDto } from "./ledger.dto.js";
import { LedgerService } from "./ledger.service.js";

@Controller("ledger")
@UseGuards(RolesGuard)
export class LedgerController {
  constructor(private readonly ledger: LedgerService) {}

  @Get()
  @RequireRole("admin")
  @ZodSerializerDto(LedgerPageDto)
  list(
    @CurrentScope() scope: RequestScope,
    @Query() query: ListLedgerQueryDto,
  ): Promise<LedgerPage> {
    return this.ledger.query(scope, query);
  }
}
