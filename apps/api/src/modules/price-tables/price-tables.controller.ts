/**
 * Price-tables controller (ADR 0053). SessionGuard authenticates; @ZodSerializerDto
 * strips responses (spec §8). Append-only surface: list + get + publish +
 * resolve-active, NO update/delete (a stamped version is immutable, I3). The
 * whole surface IS prices, so it is role-gated to admin + sales (ADR 0056) —
 * the price-blind `workshop` role is 403'd outright; publish is admin-only.
 */
import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";

import { type PriceTableDetail, type PriceTablesPage } from "@repo/validators/price-tables";

import { ZodSerializerDto } from "../../common/api/zod.js";
import { Idempotent } from "../../common/idempotency/idempotent.decorator.js";
import { RequireRole } from "../../common/rbac/require-role.decorator.js";
import { CurrentScope } from "../../common/tenancy/current-scope.decorator.js";
import { type RequestScope } from "../../common/tenancy/request-scope.js";
import { RolesGuard } from "../auth/roles.guard.js";
import { SessionGuard } from "../auth/session.guard.js";
import {
  ActivePriceTableQueryDto,
  ListPriceTablesQueryDto,
  PriceTableDto,
  PriceTablesPageDto,
  PublishPriceTableDto,
} from "./price-tables.dto.js";
import { PriceTablesService } from "./price-tables.service.js";

@Controller("price-tables")
@UseGuards(SessionGuard, RolesGuard)
@RequireRole("admin", "sales")
export class PriceTablesController {
  constructor(private readonly priceTables: PriceTablesService) {}

  @Get()
  @ZodSerializerDto(PriceTablesPageDto)
  list(
    @CurrentScope() scope: RequestScope,
    @Query() query: ListPriceTablesQueryDto,
  ): Promise<PriceTablesPage> {
    return this.priceTables.list(scope, query);
  }

  /** Setting prices is admin-only (overrides the class admin+sales gate). */
  @Post()
  @RequireRole("admin")
  @Idempotent()
  @ZodSerializerDto(PriceTableDto)
  publish(
    @CurrentScope() scope: RequestScope,
    @Body() body: PublishPriceTableDto,
  ): Promise<PriceTableDetail> {
    return this.priceTables.publish(scope, body);
  }

  /** The price table active at `asOf` (defaults to now). Static route — wins
   *  over `:id` in the router. */
  @Get("active")
  @ZodSerializerDto(PriceTableDto)
  active(
    @CurrentScope() scope: RequestScope,
    @Query() query: ActivePriceTableQueryDto,
  ): Promise<PriceTableDetail> {
    return this.priceTables.resolveActive(scope, query.asOf ? new Date(query.asOf) : undefined);
  }

  @Get(":id")
  @ZodSerializerDto(PriceTableDto)
  get(
    @CurrentScope() scope: RequestScope,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<PriceTableDetail> {
    return this.priceTables.get(scope, id);
  }
}
