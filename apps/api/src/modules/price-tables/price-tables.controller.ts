/**
 * Price-tables controller (ADR 0053). SessionGuard authenticates; @ZodSerializerDto
 * strips responses (spec §8). Append-only surface: list + get + publish +
 * resolve-active, NO update/delete (a stamped version is immutable, I3).
 * `publish` is authenticated-only for now — the admin RoleGuard lands with the
 * roles slice.
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
import { CurrentScope } from "../../common/tenancy/current-scope.decorator.js";
import { type RequestScope } from "../../common/tenancy/request-scope.js";
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
@UseGuards(SessionGuard)
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

  @Post()
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
