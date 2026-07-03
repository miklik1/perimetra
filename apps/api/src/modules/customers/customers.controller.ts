/**
 * Customers controller (ADR 0082). The global SessionGuard (ADR 0099)
 * authenticates; RolesGuard +
 * @RequireRole gate the commercial surface to admin/sales (workshop is 403 — it
 * is price-blind and never touches buyer data). The service applies per-rep
 * ownership on top of the org scope from the role. @ZodSerializerDto strips every
 * response (spec §8). Ownership 404s (not 403s) come from the service.
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";

import { type Customer, type CustomersPage } from "@repo/validators/customers";

import { ZodSerializerDto } from "../../common/api/zod.js";
import { Idempotent } from "../../common/idempotency/idempotent.decorator.js";
import { CurrentRole } from "../../common/rbac/current-role.decorator.js";
import { type OrgRole } from "../../common/rbac/org-role.js";
import { RequireRole } from "../../common/rbac/require-role.decorator.js";
import { CurrentScope } from "../../common/tenancy/current-scope.decorator.js";
import { type RequestScope } from "../../common/tenancy/request-scope.js";
import { RolesGuard } from "../auth/roles.guard.js";
import {
  CreateCustomerDto,
  CustomerDto,
  CustomersPageDto,
  ListCustomersQueryDto,
  UpdateCustomerDto,
} from "./customers.dto.js";
import { CustomersService } from "./customers.service.js";

@Controller("customers")
@UseGuards(RolesGuard)
@RequireRole("admin", "sales")
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  @ZodSerializerDto(CustomersPageDto)
  list(
    @CurrentScope() scope: RequestScope,
    @CurrentRole() role: OrgRole,
    @Query() query: ListCustomersQueryDto,
  ): Promise<CustomersPage> {
    return this.customers.list(scope, role, query);
  }

  @Post()
  @Idempotent()
  @ZodSerializerDto(CustomerDto)
  create(@CurrentScope() scope: RequestScope, @Body() body: CreateCustomerDto): Promise<Customer> {
    return this.customers.create(scope, body);
  }

  @Get(":id")
  @ZodSerializerDto(CustomerDto)
  get(
    @CurrentScope() scope: RequestScope,
    @CurrentRole() role: OrgRole,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<Customer> {
    return this.customers.get(scope, role, id);
  }

  @Patch(":id")
  @ZodSerializerDto(CustomerDto)
  update(
    @CurrentScope() scope: RequestScope,
    @CurrentRole() role: OrgRole,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: UpdateCustomerDto,
  ): Promise<Customer> {
    return this.customers.update(scope, role, id, body);
  }

  /** GDPR "forget" — anonymizes the buyer PII in place + archives (ADR 0071). */
  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentScope() scope: RequestScope,
    @CurrentRole() role: OrgRole,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.customers.erase(scope, role, id);
  }
}
