/**
 * The default `BILLING_PROVIDER` binding: deterministic stand-in for tests
 * and provider-less dev. Honest by construction — it never pretends money
 * moved: checkouts "succeed" with an inert URL, nobody has a subscription
 * until `cancelAt` is asked to invent one, and every call logs at debug so a
 * project that forgot to swap the adapter can see why billing is inert.
 */
import { Injectable, Logger } from "@nestjs/common";

import {
  type BillingProvider,
  type BillingSubscription,
  type CheckoutSession,
  type CreateCheckoutInput,
} from "./billing.provider.js";

@Injectable()
export class NoopBillingProvider implements BillingProvider {
  private readonly logger = new Logger(NoopBillingProvider.name);

  async createCheckout(input: CreateCheckoutInput): Promise<CheckoutSession> {
    this.logger.debug(`noop checkout for owner ${input.ownerId}, plan ${input.planId}`);
    return {
      providerSessionId: `noop_session_${input.ownerId}_${input.planId}`,
      // Deliberately inert: a client redirect goes nowhere instead of
      // silently "succeeding" at a fake provider.
      url: `about:blank#noop-checkout/${input.planId}`,
    };
  }

  async getSubscription(providerCustomerId: string): Promise<BillingSubscription | null> {
    this.logger.debug(`noop getSubscription(${providerCustomerId}) -> null`);
    return null;
  }

  async cancelAt(
    providerSubscriptionId: string,
    when: "period_end" | Date,
  ): Promise<BillingSubscription> {
    this.logger.debug(`noop cancelAt(${providerSubscriptionId})`);
    const periodEnd = when === "period_end" ? null : when.toISOString();
    return {
      providerSubscriptionId,
      providerCustomerId: "noop_customer",
      planId: "noop_plan",
      status: "canceled",
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: when === "period_end",
    };
  }
}
