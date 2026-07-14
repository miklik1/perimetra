/**
 * Orders controller (ADR 0109 / ADR-O1). Conventions on display:
 * - Global SessionGuard (APP_GUARD) authenticates; class-level RolesGuard
 *   resolves the caller's org role and 403s a non-member.
 * - Role gates (ADR 0056): create is a commercial action (admin/sales);
 *   start/complete are shop-floor (admin/workshop); cancel is admin-only.
 *   list/get/production carry NO `@RequireRole` — every role sees orders
 *   (the workshop works from orders, not quotes), and the production view is
 *   role-independent + always price-blind.
 * - `@Idempotent()` on create (a money-committing action).
 * - `@ZodSerializerDto` strips every response (spec §8); ownership 404s (not
 *   403s) come from the service — same shape whether missing or another org's.
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

import { type OrderDetail, type OrdersPage } from "@repo/validators/orders";
import { type QuoteProduction } from "@repo/validators/quotes";

import { ZodSerializerDto } from "../../common/api/zod.js";
import { Idempotent } from "../../common/idempotency/idempotent.decorator.js";
import { RequireRole } from "../../common/rbac/require-role.decorator.js";
import { CurrentScope } from "../../common/tenancy/current-scope.decorator.js";
import { type RequestScope } from "../../common/tenancy/request-scope.js";
import { RolesGuard } from "../auth/roles.guard.js";
import {
  CancelOrderDto,
  CreateOrderDto,
  ListOrdersQueryDto,
  OrderDto,
  OrderProductionDto,
  OrdersPageDto,
} from "./orders.dto.js";
import { OrdersService } from "./orders.service.js";

@Controller("orders")
@UseGuards(RolesGuard)
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  @ZodSerializerDto(OrdersPageDto)
  list(
    @CurrentScope() scope: RequestScope,
    @Query() query: ListOrdersQueryDto,
  ): Promise<OrdersPage> {
    return this.orders.list(scope, query);
  }

  /** Confirm an accepted quote into an order — sales + admin only. */
  @Post()
  @RequireRole("admin", "sales")
  @Idempotent()
  @ZodSerializerDto(OrderDto)
  create(@CurrentScope() scope: RequestScope, @Body() body: CreateOrderDto): Promise<OrderDetail> {
    return this.orders.create(scope, body);
  }

  @Get(":id")
  @ZodSerializerDto(OrderDto)
  get(
    @CurrentScope() scope: RequestScope,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<OrderDetail> {
    return this.orders.get(scope, id);
  }

  /** The re-homed workshop production view (price-blind, role-independent). */
  @Get(":id/production")
  @ZodSerializerDto(OrderProductionDto)
  production(
    @CurrentScope() scope: RequestScope,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<QuoteProduction> {
    return this.orders.getProduction(scope, id);
  }

  /** Start production — workshop drives its own floor; admin may too. */
  @Post(":id/start")
  @HttpCode(HttpStatus.OK)
  @RequireRole("admin", "workshop")
  @ZodSerializerDto(OrderDto)
  start(
    @CurrentScope() scope: RequestScope,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<OrderDetail> {
    return this.orders.start(scope, id);
  }

  @Post(":id/complete")
  @HttpCode(HttpStatus.OK)
  @RequireRole("admin", "workshop")
  @ZodSerializerDto(OrderDto)
  complete(
    @CurrentScope() scope: RequestScope,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<OrderDetail> {
    return this.orders.complete(scope, id);
  }

  /** Cancel — admin only, reason required (audited). */
  @Post(":id/cancel")
  @HttpCode(HttpStatus.OK)
  @RequireRole("admin")
  @ZodSerializerDto(OrderDto)
  cancel(
    @CurrentScope() scope: RequestScope,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: CancelOrderDto,
  ): Promise<OrderDetail> {
    return this.orders.cancel(scope, id, body.reason);
  }
}
