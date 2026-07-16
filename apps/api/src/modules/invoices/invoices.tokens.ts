/**
 * Invoice event-type names (own file — same cycle-avoidance rule as
 * `auth.tokens.ts`): the api-side service emits them inside the issue/mark-paid
 * transaction, the worker-side handler consumes them; neither imports the other.
 */
export const INVOICE_ISSUED = "invoice.issued";
export const INVOICE_PAID = "invoice.paid";
