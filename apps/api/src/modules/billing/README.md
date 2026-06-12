# billing — provider-agnostic billing seam

**Status: seam, not feature** (spec §7.6, ADR 0034). This module is the
interface a project codes against (`BillingProvider` +
`Customer/Subscription/Entitlement` types), a `NoopBillingProvider` default
binding, and THIS recipe. **No provider SDK is installed, no billing tables
exist, no UI ships.** Ten derived projects will pick three different
providers; the thing worth standardizing is the shape, not the vendor.

## The architecture in one paragraph

The app makes exactly three synchronous calls (`createCheckout`,
`getSubscription`, `cancelAt`) through the `BILLING_PROVIDER` token.
Everything else — renewals, payment failures, plan changes, refunds — is
asynchronous and arrives on the **provider's webhook**, which is translated
into provider-agnostic `billing.*` **outbox events** (`BILLING_EVENTS`).
Domain reactions (grant entitlements, send dunning email, lock workspace) are
ordinary `DomainEventHandler`s — they never see Stripe/Polar/Paddle naming,
so swapping providers touches one adapter class and one ingestion controller,
nothing downstream. Provider state is the source of truth; any local
subscription row is a cache rebuilt from webhooks.

## Adopting a provider (the checklist)

1. **Adapter:** implement `BillingProvider` over the provider's SDK; swap the
   `useClass` in `BillingModule`. Map provider price/variant ids → your
   `planId`s at this edge.
2. **Plan → entitlement map:** a constant `Record<planId, Entitlement[]>`
   next to the adapter. Feature gates check entitlements
   (`projects.max`, `sso`, …), never plan ids — pricing experiments stay out
   of domain code.
3. **Ingestion endpoint** (the webhook-to-outbox recipe below).
4. **Domain handlers** for the `BILLING_EVENTS` you care about, registered
   like every other handler (`OutboxWorkerModule`'s
   `@gen:domain-event-handlers` anchor).

## Webhook-to-outbox ingestion recipe

```
provider webhook ──> verify signature ──> translate to billing.* ──> outbox.emit()
   (raw body!)        (provider SDK /        (IDs only, ADR 0037)      └─> relay ─> events queue
                       constructEvent)                                      └─> domain handlers
```

```ts
@Controller({ path: "billing/webhooks", version: VERSION_NEUTRAL })
export class BillingWebhookController {
  constructor(private readonly outbox: OutboxService) {}

  // NOTE: signature schemes sign the RAW request body — register a Fastify
  // raw-body config for this route; a re-serialized JSON.parse round-trip
  // breaks verification.
  @Post()
  @HttpCode(200)
  @Transactional() // outbox.emit() requires the active scope (ADR 0037)
  async ingest(@Req() req: RawBodyRequest) {
    // 1. VERIFY first, against the raw bytes. 4xx on failure — never enqueue
    //    unverified payloads. (Stripe: webhooks.constructEvent; Polar/Paddle/
    //    LS: their HMAC equivalents. Same t=,v1= idea as ../webhooks.)
    const event = verifyWithProviderSdk(req.rawBody, req.headers, WEBHOOK_SECRET);

    // 2. TRANSLATE provider-specific types to the agnostic vocabulary and
    //    STRIP to IDs (ADR 0037: no PII, no amounts, no card data in the
    //    outbox/Redis). Handlers re-fetch truth via provider.getSubscription.
    const mapped = mapProviderEvent(event); // e.g. customer.subscription.updated
    if (!mapped) return { received: true }; //      -> billing.subscription.updated

    // 3. EMIT. The outbox gives dedup leverage too: aggregateId = the
    //    provider event id makes redeliveries traceable, and handlers get
    //    at-least-once + DLQ + replay for free (ADR 0043).
    await this.outbox.emit({
      aggregateType: "billing",
      aggregateId: event.id, // provider event id
      eventType: mapped.type, // BILLING_EVENTS.*
      payload: { ownerId: mapped.ownerId, providerSubscriptionId: mapped.subscriptionId },
    });
    return { received: true };
  }
}
```

Rules that make this robust:

- **Verify, then 200 fast.** All processing is in handlers, not the
  controller — providers retry slow/failing endpoints and eventually disable
  them.
- **Idempotency comes from re-fetching.** Handlers call
  `provider.getSubscription()` and upsert the result — replaying any webhook
  (provider retry, DLQ replay, out-of-order delivery) converges on provider
  truth instead of applying deltas twice.
- **Unmapped event types are a 200 + debug log**, not an error — providers
  add types; your endpoint must not start failing when they do.
- **Route exemptions:** the ingestion route is unauthenticated
  (signature IS the auth), exempt from CSRF/idempotency interceptors, and
  rate-limited generously.

## EU note: merchant-of-record providers

For EU-based owners (this skeleton's home market), **merchant-of-record**
providers — **Polar, Paddle, Lemon Squeezy** — are the VAT-sane default:
they are the seller of record, so EU VAT MOSS/OSS registration, per-country
rates, invoicing, and remittance are THEIR problem, not a quarterly filing
marathon. Stripe (Billing + Tax) gives more control and lower fees but you
remain the merchant: VAT registration and filings stay yours. Rule of thumb:
SaaS sold cross-border by a small team → MoR; marketplace/usage-billing or
fee-sensitive scale with an accountant on retainer → Stripe. The
`BillingProvider` interface is deliberately satisfiable by all of the above —
hosted checkout + webhook is the shared shape.

## If you cache subscriptions locally

Add the table in your project (ADR 0032 conventions); treat it strictly as a
read-model rebuilt from webhooks:

```ts
export const subscription = pgTable("subscription", {
  id: id(),
  ownerId: text("owner_id").notNull().unique(), // userId, or orgId (ADR 0041)
  providerCustomerId: text("provider_customer_id").notNull(),
  providerSubscriptionId: text("provider_subscription_id").notNull(),
  planId: text("plan_id").notNull(),
  status: text("status").notNull().$type<SubscriptionStatus>(),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  ...timestamps(),
});
```

Entitlement checks then read this row (one indexed lookup per gate), and a
`billing.subscription.updated` handler upserts it from
`provider.getSubscription()`. Don't forget the privacy handler (ADR 0040):
provider customer ids are personal data — erasure must delete the provider
customer too.
