/**
 * Billing seam (spec §7.6, ADR 0034): provider-agnostic INTERFACES only.
 * No provider SDK is installed, no billing tables exist, no UI ships — a
 * project picks Stripe/Polar/Paddle/Lemon Squeezy (EU note in README.md)
 * and writes ONE adapter class against `BillingProvider`; everything
 * downstream (entitlement checks, webhook-driven domain handlers) is coded
 * against this file and never changes when the provider does.
 *
 * Scope rule: this interface covers the three calls the APP makes
 * synchronously. Everything ASYNCHRONOUS (renewals, payment failures, plan
 * changes made in the provider's portal) arrives via the provider's webhook
 * and flows webhook → verify → outbox `billing.*` event → domain handlers —
 * the ingestion recipe in README.md. Provider state is the source of truth;
 * local rows are a cache rebuilt from webhooks.
 */

export const SUBSCRIPTION_STATUSES = [
  "trialing",
  "active",
  "past_due",
  "canceled",
  "incomplete",
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/** The link between a skeleton user/org and the provider's customer object. */
export interface BillingCustomer {
  /** Provider-side id (`cus_…` and friends) — opaque here. */
  providerCustomerId: string;
  /** The skeleton-side owner: a userId, or an orgId once tenancy wakes (ADR 0041). */
  ownerId: string;
}

export interface BillingSubscription {
  providerSubscriptionId: string;
  providerCustomerId: string;
  /** YOUR plan identifier (price/variant id mapped at the adapter edge). */
  planId: string;
  status: SubscriptionStatus;
  /** ISO timestamp; null for non-renewing (lifetime/manual) arrangements. */
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

/**
 * What a plan GRANTS, decoupled from what it COSTS: feature gates check
 * entitlements, never plan ids — pricing experiments then never touch
 * domain code. The planId → Entitlement[] mapping is project config (a
 * constant map next to the adapter), not provider state.
 */
export interface Entitlement {
  /** Namespaced key, e.g. `projects.max`, `api.requests_per_day`, `sso`. */
  key: string;
  /** `true` for boolean gates, a number for limits. */
  value: boolean | number;
}

export interface CreateCheckoutInput {
  ownerId: string;
  planId: string;
  /** Provider redirects here after payment (include a session reference). */
  successUrl: string;
  cancelUrl: string;
}

export interface CheckoutSession {
  providerSessionId: string;
  /** Hosted-checkout URL the client redirects to. */
  url: string;
}

/**
 * The three synchronous calls. Anything a concrete provider offers beyond
 * these (portals, invoices, seats…) is added per-project — widening this
 * interface speculatively is how seams rot into frameworks.
 */
export interface BillingProvider {
  /** Start a hosted checkout for a plan; the outcome arrives via webhook. */
  createCheckout(input: CreateCheckoutInput): Promise<CheckoutSession>;
  /** Read-through to provider truth; null = no subscription for that customer. */
  getSubscription(providerCustomerId: string): Promise<BillingSubscription | null>;
  /**
   * Schedule cancellation: `"period_end"` (the default churn-friendly path —
   * access until what was paid for runs out) or a concrete date where the
   * provider supports it. Immediate cancellation is `new Date()`.
   */
  cancelAt(providerSubscriptionId: string, when: "period_end" | Date): Promise<BillingSubscription>;
}
