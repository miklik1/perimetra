/**
 * Order outbox event-type names (own file — same cycle-avoidance rule as
 * `auth.tokens.ts`): the api-side service emits them, the worker-side handler
 * consumes them, neither imports the other. IDs-only payloads (ADR 0037),
 * named for the federation horizon (ADR-O1: `order.*` fold into the hub later).
 */
export const ORDER_CONFIRMED = "order.confirmed";
export const ORDER_PRODUCTION_STARTED = "order.production_started";
export const ORDER_COMPLETED = "order.completed";
export const ORDER_CANCELLED = "order.cancelled";
