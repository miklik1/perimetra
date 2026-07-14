/**
 * nestjs-zod DTOs over the shared contracts (`@repo/validators/orders`) — the
 * classes give Nest something to hang pipe/serializer metadata on; the zod
 * schemas stay the single source of truth. The production endpoint re-uses the
 * price-blind `quoteProductionSchema` verbatim (the projection is identical —
 * an order's production view IS its quote's, resolved through the snapshot).
 */
import {
  cancelOrderSchema,
  createOrderSchema,
  listOrdersQuerySchema,
  orderSchema,
  ordersPageSchema,
} from "@repo/validators/orders";
import { quoteProductionSchema } from "@repo/validators/quotes";

import { createZodDto } from "../../common/api/zod.js";

export class CreateOrderDto extends createZodDto(createOrderSchema) {}
export class CancelOrderDto extends createZodDto(cancelOrderSchema) {}
export class ListOrdersQueryDto extends createZodDto(listOrdersQuerySchema) {}

/** Response DTOs — used with `@ZodSerializerDto` (strip semantics, spec §8). */
export class OrderDto extends createZodDto(orderSchema) {}
export class OrdersPageDto extends createZodDto(ordersPageSchema) {}
export class OrderProductionDto extends createZodDto(quoteProductionSchema) {}
