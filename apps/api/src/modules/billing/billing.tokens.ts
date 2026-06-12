/**
 * Billing seam tokens + event-type names (own file — same cycle-avoidance
 * rule as `auth.tokens.ts`). The interfaces live in `billing.provider.ts`;
 * the ingestion recipe (provider webhook → verify → outbox → these event
 * types) lives in README.md.
 */

/** DI token for the active `BillingProvider` (Noop until a project picks one). */
export const BILLING_PROVIDER = Symbol("BILLING_PROVIDER");

/**
 * The provider-agnostic billing event vocabulary. The ingestion endpoint
 * TRANSLATES provider-specific webhook types into these before emitting to
 * the outbox — domain handlers (entitlement grants, dunning emails, …) never
 * see a provider's naming scheme, so swapping providers never touches them.
 * Payloads are IDs only (ADR 0037): `{ userId, providerSubscriptionId }`,
 * never amounts or card data.
 */
export const BILLING_EVENTS = {
  checkoutCompleted: "billing.checkout.completed",
  subscriptionUpdated: "billing.subscription.updated",
  subscriptionCanceled: "billing.subscription.canceled",
  paymentFailed: "billing.payment.failed",
} as const;

export type BillingEventType = (typeof BILLING_EVENTS)[keyof typeof BILLING_EVENTS];
