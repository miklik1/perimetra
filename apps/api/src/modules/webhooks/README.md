# webhooks — outbound-webhook seam

**Status: seam, not feature** (spec §7.6, ADR 0034). The skeleton ships the
two pieces every project would otherwise reinvent badly — **signing** and
**delivery** (`WebhookDispatcher`) plus the **outbox→webhook bridge**
(`createWebhookRelayHandler`) — and deliberately ships **no endpoint
registry, no delivery log, no admin UI**. That state is project-owned: one
project has a single partner URL in an env var, another sells webhooks as a
customer feature with a CRUD'd registry table. This README is the recipe for
both.

The machinery you do NOT build: the transactional outbox (ADR 0037) already
gives you durable, exactly-once-recorded domain events, and the `events`
BullMQ processor (ADR 0043) already gives you retries with exponential
backoff, a DLQ, and bull-board replay. Outbound webhooks are ~80% "the outbox
again" — this module is the missing 20%.

## What ships here

| Piece                                                                 | Contract                                                                                                                                                       |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WebhookDispatcher.sign(payload, secret, t?)`                         | `X-Webhook-Signature: t=<unix>,v1=<hex>` where `v1 = HMAC-SHA256(secret, "<t>.<raw body>")` (Stripe-style).                                                    |
| `WebhookDispatcher.verify(header, payload, secret)`                   | Receiver-side check: constant-time compare + 300s replay tolerance.                                                                                            |
| `WebhookDispatcher.deliver(url, event, secret)`                       | One POST attempt, 5s timeout, body `{ id, type, timestamp, payload }`, dedup header `X-Webhook-Id`. **Throws on any non-2xx** — the throw IS the retry signal. |
| `createWebhookRelayHandler(dispatcher, { eventTypes, endpointsFor })` | A `DomainEventHandler` (the `DOMAIN_EVENT_HANDLERS` multi-provider shape) that fans an outbox event out to your endpoints.                                     |

Payload rule carries over from the outbox: **IDs only, never PII**
(ADR 0037/0040). Receivers re-fetch state through the API with their own
credentials — a webhook is a doorbell, not a data feed.

## Minimal binding (single consumer, env-configured)

Delivery never runs in the HTTP deployable (ADR 0031). Create a worker
module that exports the handler under a token:

```ts
export const PROJECT_WEBHOOK_RELAY = Symbol("PROJECT_WEBHOOK_RELAY");

@Module({
  imports: [WebhooksModule],
  providers: [
    {
      provide: PROJECT_WEBHOOK_RELAY,
      inject: [WebhookDispatcher, ENV],
      useFactory: (dispatcher: WebhookDispatcher, env: Env) =>
        createWebhookRelayHandler(dispatcher, {
          eventTypes: [PROJECT_CREATED, PROJECT_ARCHIVED],
          endpointsFor: () =>
            env.PARTNER_WEBHOOK_URL
              ? [{ url: env.PARTNER_WEBHOOK_URL, secret: env.PARTNER_WEBHOOK_SECRET }]
              : [],
        }),
    },
  ],
  exports: [PROJECT_WEBHOOK_RELAY],
})
export class ProjectWebhooksModule {}
```

then wire it where every domain handler is wired — `OutboxWorkerModule`'s
`DOMAIN_EVENT_HANDLERS` factory (Nest has no true multi-provider; that module
owns the one array): add `ProjectWebhooksModule` at the
`@gen:worker-modules` anchor and `PROJECT_WEBHOOK_RELAY` at the
`@gen:domain-event-handlers` inject anchor.

Retry semantics you inherit for free: the `events` processor runs the handler
with 5 attempts + exponential backoff; exhausted jobs land in the `dlq` queue
with origin metadata; replay = re-add from bull-board (ADR 0043). A retry
re-delivers to **all** endpoints (at-least-once) — receivers must dedup on
`X-Webhook-Id`, which is the outbox event id (uuidv7).

## Full feature (customer-facing endpoints): the registry recipe

When endpoints become user data, add the table **in your project** (per-module
schema dir, ADR 0032 conventions — `id()`/`timestamps()` helpers, `pnpm
--filter @repo/db db:generate` for the migration):

```ts
// @repo/db src/schema/webhooks/index.ts (project-side)
export const webhookEndpoint = pgTable(
  "webhook_endpoint",
  {
    id: id(),
    orgId: text("org_id").notNull(), // owner scope (ADR 0041)
    url: text("url").notNull(),
    /** Per-endpoint secret, shown once at creation — store encrypted or hashed-equivalent at rest. */
    secret: text("secret").notNull(),
    /** Event-type subscriptions, e.g. ["project.created"]. */
    eventTypes: jsonb("event_types").notNull().$type<string[]>(),
    /** Disabled automatically after sustained failure (see delivery log). */
    status: text("status").notNull().default("enabled").$type<"enabled" | "disabled">(),
    ...timestamps(),
  },
  (t) => [index("webhook_endpoint_org_idx").on(t.orgId)],
);

// Optional but recommended once you have >1 consumer: an append-only
// delivery log — it powers the "redeliver" button and auto-disable.
export const webhookDelivery = pgTable("webhook_delivery", {
  id: id(),
  endpointId: uuid("endpoint_id")
    .notNull()
    .references(() => webhookEndpoint.id),
  eventId: uuid("event_id").notNull(), // outbox id == X-Webhook-Id
  eventType: text("event_type").notNull(),
  status: integer("status"), // HTTP status, null = no response
  attempt: integer("attempt").notNull(),
  durationMs: integer("duration_ms"),
  ...timestamps(),
});
```

Then `endpointsFor` becomes a repository query
(`WHERE status = 'enabled' AND event_types @> '["<type>"]'`), and the CRUD
controller is an ordinary resource (copy `modules/projects`).

### Per-endpoint isolation (the production upgrade)

The shipped handler delivers inline in the `events` job, so one endpoint's
failure retries the whole fan-out (harmless — dedup — but noisy at scale).
The upgrade: declare a `webhooks` queue in the `QUEUES` registry and make the
relay handler only **enqueue** one job per (endpoint, event):

```
outbox → events queue → relay handler → webhooks queue (jobId = `${endpointId}:${eventId}`)
                                            └─ processor: dispatcher.deliver(...)  ← retries are now PER ENDPOINT
```

- jobId `${endpointId}:${eventId}` gives BullMQ-level dedup per pair.
- The `webhooks` processor's `failed` hook follows the DLQ convention
  (ADR 0043): exhausted deliveries land in `dlq` with origin metadata.
- **Replay** = re-add from bull-board, or an admin "redeliver" action that
  re-enqueues from the `webhook_delivery` log (idempotent on the receiver by
  the `X-Webhook-Id` contract).
- **Auto-disable**: a maintenance repeatable that flips endpoints to
  `disabled` after N consecutive exhausted deliveries (read the log), with an
  email to the owner — the industry-standard courtesy.

## Receiver contract (document this to your consumers)

- Verify before parse: recompute `HMAC-SHA256(secret, "<t>." + rawBody)` and
  constant-time-compare with `v1`; reject if `|now - t| > 300s`.
  (`WebhookDispatcher.verify` is this check — reuse it when the skeleton is
  on both ends.)
- Respond 2xx fast (enqueue, don't process inline — the sender's timeout
  budget is 5s) and dedup on `X-Webhook-Id`.
- Rotation: support two active secrets per endpoint during rotation; the
  scheme is versioned (`v1=`) so a future algorithm can ship as `v2=`
  alongside.
