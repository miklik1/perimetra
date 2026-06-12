# billing — provider-agnostic billing seam (ADR 0034)

A seam, deliberately NOT a feature: interfaces only, no provider SDK.
`BillingProvider` (`createCheckout` / `getSubscription` / `cancelAt`),
`BillingCustomer` / `BillingSubscription` / `Entitlement` types, the
`BILLING_EVENTS` `billing.*` event vocabulary, and `BILLING_PROVIDER` bound
to `NoopBillingProvider`. Webhook-to-outbox ingestion (verify raw body →
translate → `outbox.emit` IDs-only → idempotent handlers that re-fetch
provider truth), the EU merchant-of-record note (Polar/Paddle/Lemon Squeezy
vs Stripe), and the optional subscription cache table are README recipes.

## Public surface

- `BillingProvider` + entity types (`billing.provider.ts`) — the contract a
  Stripe/Polar/etc. adapter implements.
- `BILLING_PROVIDER` token + `BILLING_EVENTS` vocabulary
  (`billing.tokens.ts`).
- `BillingModule` — binds the Noop provider. **Unwired by design**: a
  project imports it where billing is consumed and swaps `useClass` for its
  adapter (the ONE line that changes).

## Must never

- Be registered in `app.module.ts`/`worker.module.ts` while unadopted.
- Trust webhook payloads as state — handlers re-fetch from the provider by
  id; payloads stay IDs-only (ADR 0037).
- Acquire a provider SDK dependency in the skeleton itself.

Governing ADR: `docs/adr/0034-api-contract-and-seams.md`.
