/**
 * Order contracts (ADR 0109 / ADR-O1) — the single source of truth for the
 * order surface the api serializes and the web consumes. An order is a thin
 * reference over an accepted quote (I3): it carries no money of its own; its
 * production view reuses the price-blind `quoteProductionSchema` verbatim.
 */
import { z } from "zod";

import { cursorQuerySchema, paginated } from "./api/pagination";
import { isoDatetime } from "./primitives";

// Kept in lockstep with `@repo/db/schema/orders` `ORDER_STATUSES`.
export const ORDER_STATUSES = ["confirmed", "in_production", "completed", "cancelled"] as const;
export const orderStatusSchema = z.enum(ORDER_STATUSES);
export type OrderStatus = z.infer<typeof orderStatusSchema>;

/** Response shape — what every order endpoint serializes through (strip semantics). */
export const orderSchema = z.object({
  id: z.uuid(),
  quoteId: z.uuid(),
  orderNumber: z.string(),
  status: orderStatusSchema,
  cancelReason: z.string().nullable(),
  createdAt: isoDatetime,
  updatedAt: isoDatetime,
});
export type OrderDetail = z.infer<typeof orderSchema>;

/** Create an order from an accepted quote — the quote is the whole input. */
export const createOrderSchema = z.object({
  quoteId: z.uuid(),
});
export type CreateOrderInput = z.infer<typeof createOrderSchema>;

/** Cancel requires a reason (admin action, audited). */
export const cancelOrderSchema = z.object({
  reason: z.string().min(1).max(500),
});
export type CancelOrderInput = z.infer<typeof cancelOrderSchema>;

/** Re-point the order at a newer accepted revision of the same quote (ADR-O1). */
export const repointOrderSchema = z.object({
  quoteId: z.uuid(),
});
export type RepointOrderInput = z.infer<typeof repointOrderSchema>;

/**
 * Keyset pagination (spec §8): the shared `{ cursor, limit, sort }` block plus
 * the status filter. The cursor is an order id — UUIDv7 is time-ordered.
 */
export const listOrdersQuerySchema = cursorQuerySchema.extend({
  status: orderStatusSchema.optional(),
});
export type ListOrdersQuery = z.infer<typeof listOrdersQuerySchema>;

export const ordersPageSchema = paginated(orderSchema);
export type OrdersPage = z.infer<typeof ordersPageSchema>;
