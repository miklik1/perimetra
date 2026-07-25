/**
 * Delivery event-type names (own file — the same cycle-avoidance rule as
 * `invoices.tokens.ts`): the api-side service emits inside the send
 * transaction, the worker-side handler consumes; neither imports the other.
 *
 * A2 introduces exactly ONE event type. Sending is an EXPLICIT rep act, never
 * hung off `invoice.issued` — coupling delivery to an internal state change
 * would make ISSUING equal AUTO-SENDING (a rep who issues to check numbers
 * would spam a real buyer), and it would put an irreversible outward act on the
 * outbox's at-least-once semantics (ADR 0129).
 */
export const DOCUMENT_DELIVERY_REQUESTED = "document_delivery.requested";
