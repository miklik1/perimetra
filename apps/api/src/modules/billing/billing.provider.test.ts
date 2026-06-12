import { Test } from "@nestjs/testing";
import { describe, expect, it } from "vitest";

import { BillingModule } from "./billing.module.js";
import {
  SUBSCRIPTION_STATUSES,
  type BillingCustomer,
  type BillingProvider,
  type Entitlement,
  type SubscriptionStatus,
} from "./billing.provider.js";
import { BILLING_EVENTS, BILLING_PROVIDER, type BillingEventType } from "./billing.tokens.js";
import { NoopBillingProvider } from "./noop-billing.provider.js";

describe("NoopBillingProvider", () => {
  const provider: BillingProvider = new NoopBillingProvider();

  it("creates an inert, deterministic checkout session", async () => {
    const session = await provider.createCheckout({
      ownerId: "user-1",
      planId: "pro",
      successUrl: "https://app.test/billing/success",
      cancelUrl: "https://app.test/billing/cancel",
    });
    expect(session.providerSessionId).toBe("noop_session_user-1_pro");
    expect(session.url).toMatch(/^about:blank#noop-checkout/);
  });

  it("reports no subscription for any customer (never fakes paid state)", async () => {
    await expect(provider.getSubscription("cus_anything")).resolves.toBeNull();
  });

  it("cancelAt('period_end') returns a canceled subscription flagged cancelAtPeriodEnd", async () => {
    const subscription = await provider.cancelAt("sub_1", "period_end");
    expect(subscription.status).toBe("canceled");
    expect(subscription.cancelAtPeriodEnd).toBe(true);
    expect(subscription.currentPeriodEnd).toBeNull();
  });

  it("cancelAt(date) returns the date as the period end", async () => {
    const at = new Date("2026-07-01T00:00:00.000Z");
    const subscription = await provider.cancelAt("sub_1", at);
    expect(subscription.cancelAtPeriodEnd).toBe(false);
    expect(subscription.currentPeriodEnd).toBe("2026-07-01T00:00:00.000Z");
  });
});

describe("billing seam contract", () => {
  it("pins the provider-agnostic event vocabulary (domain handlers key off these strings)", () => {
    expect(BILLING_EVENTS).toEqual({
      checkoutCompleted: "billing.checkout.completed",
      subscriptionUpdated: "billing.subscription.updated",
      subscriptionCanceled: "billing.subscription.canceled",
      paymentFailed: "billing.payment.failed",
    });
    // Every value is namespaced under billing.* (outbox eventType convention).
    for (const eventType of Object.values(BILLING_EVENTS)) {
      expect(eventType).toMatch(/^billing\./);
    }
  });

  it("pins the subscription status vocabulary", () => {
    expect(SUBSCRIPTION_STATUSES).toEqual([
      "trialing",
      "active",
      "past_due",
      "canceled",
      "incomplete",
    ]);
  });

  it("type-level: the seam shapes compile as projects will use them", () => {
    const customer: BillingCustomer = { providerCustomerId: "cus_1", ownerId: "user-1" };
    const entitlements: Entitlement[] = [
      { key: "projects.max", value: 10 },
      { key: "sso", value: true },
    ];
    const status: SubscriptionStatus = "active";
    const eventType: BillingEventType = BILLING_EVENTS.subscriptionUpdated;
    expect([customer, entitlements, status, eventType]).toBeDefined();
  });
});

describe("BillingModule", () => {
  it("binds BILLING_PROVIDER to the noop implementation by default", async () => {
    const moduleRef = await Test.createTestingModule({ imports: [BillingModule] }).compile();
    expect(moduleRef.get<BillingProvider>(BILLING_PROVIDER)).toBeInstanceOf(NoopBillingProvider);
    await moduleRef.close();
  });
});
