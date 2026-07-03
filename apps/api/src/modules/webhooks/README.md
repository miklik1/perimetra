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

| Piece                                                                 | Contract                                                                                                                                                                                                                 |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `WebhookDispatcher.sign(payload, secret, t?)`                         | `X-Webhook-Signature: t=<unix>,v1=<hex>` where `v1 = HMAC-SHA256(secret, "<t>.<raw body>")` (Stripe-style).                                                                                                              |
| `WebhookDispatcher.verify(header, payload, secret)`                   | Receiver-side check: constant-time compare + 300s replay tolerance.                                                                                                                                                      |
| `WebhookDispatcher.deliver(url, event, secret)`                       | One POST attempt, 5s timeout, body `{ id, type, timestamp, payload }`, dedup header `X-Webhook-Id`. **Throws on any non-2xx** — the throw IS the retry signal. Every request first passes the SSRF egress guard (below). |
| `createWebhookRelayHandler(dispatcher, { eventTypes, endpointsFor })` | A `DomainEventHandler` (the `DOMAIN_EVENT_HANDLERS` multi-provider shape) that fans an outbox event out to your endpoints.                                                                                               |

Payload rule carries over from the outbox: **IDs only, never PII**
(ADR 0037/0040). Receivers re-fetch state through the API with their own
credentials — a webhook is a doorbell, not a data feed.

## SSRF egress guard — REQUIRED control

Webhook URLs are user-suppliable, which makes an unguarded dispatcher
SSRF-as-a-service: a customer registers `http://169.254.169.254/…` and your
worker exfiltrates cloud credentials for them. `deliver()` therefore runs
the shared egress guard (`src/common/http/ssrf-guard.ts`) in **two layers**,
and any replacement dispatcher (the per-endpoint-queue upgrade below
included) **MUST keep both** — each layer covers a hole the other cannot:

- **Layer 1 — synchronous pre-flight** (`assertEgressUrlAllowed`), re-run on
  the first request **and every redirect hop**: `http:`/`https:` only
  (always, even with the opt-out), and an IP-LITERAL host must classify as
  ordinary global unicast. This is the only layer that fires for literal-IP
  targets — undici skips DNS (and therefore layer 2's lookup) entirely for
  them. WHATWG URL parsing canonicalizes obfuscated hosts (`2130706433`,
  `0x7f.0.0.1` → `127.0.0.1`) first, and **both** IPv4-mapped
  (`::ffff:a.b.c.d`) and IPv4-compatible (`::/96`, `::a.b.c.d`) IPv6 are
  recursed into their embedded v4 before classification.
- **Layer 2 — rebinding-safe dispatcher** (`createSsrfGuardedDispatcher`):
  every guarded request is fetched through an undici `Agent` whose connector
  resolves the hostname, validates **every** returned address (A + AAAA; a
  mix of public + private is refused as hostile), and connects to that
  **same validated resolution**. DNS rebinding — the classic
  check-then-reconnect TOCTOU — is closed by construction: there is no
  second lookup for a hostile resolver to poison. One dispatcher is built
  per delivery and reused across its redirect hops.
- **Allowlist stance**: only globally-routable unicast may egress
  (`ipaddr.js` `range() === "unicast"`). Everything else is refused **by
  class, not by enumeration**: loopback, RFC1918, link-local (incl. the
  metadata endpoints `169.254.169.254` / `fd00:ec2::254`), unique-local,
  CGNAT, unspecified, broadcast, reserved, multicast, and the v4-embedding
  v6 transition ranges a blocklist forgets (6to4, Teredo, NAT64).
- **Redirects**: `fetch` runs with `redirect: "manual"`; the dispatcher
  follows `Location` itself, max 3 hops, re-running the layer-1 pre-flight
  on each target while layer 2 gates each hop's connection — and re-POSTs
  the **identical signed body** (webhooks are not browsers: no GET downgrade
  on 301/302/303). A blocked target or a fourth redirect fails the delivery
  like any other failure (→ BullMQ retry/DLQ).
- **Metadata hostnames** (`metadata.google.internal`, `metadata.goog`) are
  refused before DNS ever runs — a cheap extra in front of the address gate.
- **Opt-out**: `deliver(..., { allowPrivateNetwork: true })` /
  `WebhookEndpointTarget.allowPrivateNetwork` skips the address checks AND
  the guarded dispatcher (plain fetch — the guarded connector would refuse
  to dial the very private address you explicitly trusted); the scheme check
  still applies. For **trusted first-party targets a project controls** —
  never expose it to customer input (it must not be a column customers can
  set).
- **Responses are never read**: the receiver's body is `cancel()`ed, not
  buffered — a hostile receiver cannot stream an unbounded body into worker
  memory.

Blocked deliveries throw `WebhookDeliveryError` (status `null`) with a
`blocked: <reason>` message, so they are recorded/retried/DLQ'd exactly like
network failures.

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
