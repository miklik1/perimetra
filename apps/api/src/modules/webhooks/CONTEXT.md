# webhooks — outbound webhook seam (ADR 0034)

A seam, deliberately NOT a feature: `WebhookDispatcher` does Stripe-style
signing (`X-Webhook-Signature: t=,v1=` HMAC-SHA256 over `<t>.<raw body>`),
receiver-side `verify()` (constant-time + 300s replay tolerance), and
`deliver()` (fetch, 5s timeout, `X-Webhook-Id` dedup header, throws on any
non-2xx so the events processor's attempts/backoff/DLQ IS the retry policy).
`createWebhookRelayHandler()` produces a `DomainEventHandler` projects bind
to endpoint config THEY own. Endpoint registry/tables are recipes in
README.md, not code.

## Public surface

- `WebhookDispatcher` — `sign()` / `verify()` / `deliver()`.
- `createWebhookRelayHandler(dispatcher, opts)` — allSettled fan-out,
  AggregateError if any endpoint failed (so the job retries).
- `WebhooksModule` — exports the dispatcher. **Unwired by design**: nothing
  imports it; a project imports it into its WORKER module and appends the
  relay handler to `DOMAIN_EVENT_HANDLERS` (ADR 0043).

## Must never

- Be registered in `app.module.ts` — delivery belongs in the events
  processor (worker deployable, ADR 0031), never the HTTP path.
- Deliver synchronously from a request handler or swallow non-2xx (both
  destroy the outbox retry guarantee).
- Own endpoint configuration — which URLs/secrets/events is project state.

Governing ADR: `docs/adr/0034-api-contract-and-seams.md`.
