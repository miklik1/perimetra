/**
 * nestjs-zod DTOs over the shared contracts (`@repo/validators/customers`) —
 * the classes give Nest something to hang pipe/serializer metadata (and,
 * later, OpenAPI) on; the zod schemas stay the single source of truth.
 */
import {
  createCustomerSchema,
  customerSchema,
  customersPageSchema,
  listCustomersQuerySchema,
  updateCustomerSchema,
} from "@repo/validators/customers";

import { createZodDto } from "../../common/api/zod.js";

export class CreateCustomerDto extends createZodDto(createCustomerSchema) {}
export class UpdateCustomerDto extends createZodDto(updateCustomerSchema) {}
export class ListCustomersQueryDto extends createZodDto(listCustomersQuerySchema) {}

/** Response DTOs — used with `@ZodSerializerDto` (strip semantics, spec §8). */
export class CustomerDto extends createZodDto(customerSchema) {}
export class CustomersPageDto extends createZodDto(customersPageSchema) {}
