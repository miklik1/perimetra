# ADR 0034 — API contract (shared zod) + the thin seams: webhooks, billing, AI, API keys

**Status:** Accepted (2026-06-11). Records retroactively the contract decision
that shipped inside [ADR 0039](0039-api-semantics.md); extends
[ADR 0019](0019-openapi-codegen-seam.md) (codegen seam) and
[ADR 0030](0030-api-response-envelope-seam.md) (envelope seam); seams mandated
by spec §7.6. API-key note constrained by [ADR 0033](0033-better-auth.md)'s
CVE policy.

## Context

Two loose ends close here. **First, the contract.** ADR 0007/0019 decided
zod-in-`@repo/validators` from the frontend's side and ADR 0030 made the
client envelope-agnostic — but when the backend landed, the decision that one
schema object is THE wire contract for both halves shipped implicitly inside
ADR 0039's validation/serialization machinery. A decision this load-bearing
deserves its own record. **Second, the seams.** The survey behind spec §7.6
says derived projects predictably need outbound webhooks, billing, AI, and
API keys — and that building any of them as a _feature_ in a skeleton
produces demo-ware that every project rips out. Phase 8 ships them as seams:
the interface + the hard 20% + a recipe, never tables/UI/SDKs.

## Decision

### 1. Shared-zod contract (retroactive)

The zod schemas in `@repo/validators` are the single wire contract, consumed
identically by all parties:

- **Backend in:** nestjs-zod DTOs (`createZodDto` over the shared schema) +
  global `APP_PIPE` → 422 ApiError envelope (ADR 0039).
- **Backend out:** mandatory `@ZodSerializerDto` strip-serialization — the
  response IS the schema, unenumerated columns can't leak (ADR 0039).
- **Frontend:** the same objects validate forms (RHF resolver, ADR 0009) and
  parse responses at the data seam (ADR 0007/0014); the transport unwraps
  envelopes first (ADR 0030).
- **OpenAPI** is _generated from_ these schemas (snapshot-gated) — the
  document is a projection of the contract, never a second source of truth.
  When a project flips direction (external spec first), ADR 0019's codegen
  seam emits zod _into_ `@repo/validators` and everything downstream is
  unchanged — the package boundary is the contract, whichever way schemas
  flow into it.

### 2. Outbound webhooks — `modules/webhooks` (seam)

The outbox + BullMQ pipeline (ADR 0037/0043) already provides durability,
retries, backoff, DLQ, and replay — webhooks are ~80% "the outbox again". The
module ships only the missing 20%: `WebhookDispatcher` —
`sign()`/`verify()` (Stripe-style `t=,v1=` HMAC-SHA256 over
`"<t>.<raw body>"`, known-vector-pinned in tests) and `deliver()` (fetch,
5s timeout, `X-Webhook-Id` dedup header, **throws on non-2xx** so the events
processor's retry/DLQ machinery is the retry policy) — plus
`createWebhookRelayHandler()`, a `DomainEventHandler`-shaped factory a
project binds to endpoint config it owns. Endpoint registry table, delivery
log, per-endpoint queue isolation, and auto-disable are a documented recipe
(module README), not code: endpoint state is project-owned (env var for one
partner vs. customer-facing CRUD are different products).

### 3. Billing — `modules/billing` (seam)

Provider-agnostic interfaces only: `BillingProvider`
(`createCheckout`/`getSubscription`/`cancelAt`) +
`BillingCustomer`/`BillingSubscription`/`Entitlement`, a `NoopBillingProvider`
bound to `BILLING_PROVIDER` by default, and the agnostic event vocabulary
(`BILLING_EVENTS`: `billing.*`). **No provider SDK is installed.** The async
half is a recipe: provider webhook → verify raw body → translate to
`billing.*` → `outbox.emit()` (IDs only) → domain handlers that re-fetch
provider truth (idempotent under provider retries AND DLQ replays). Feature
gates check _entitlements_, never plan ids. EU stance documented:
merchant-of-record providers (Polar/Paddle/Lemon Squeezy) are the VAT-sane
default for the home market; Stripe when control outweighs the filing burden.

### 4. AI — `@repo/ai` (seam)

A BUILT package (`@repo/db` conventions) containing interfaces
(`ChatModel`/`EmbeddingModel`), `createAiRouter()` (named-model registry, one
composition point — ADR 0012's factory doctrine), and noop defaults (empty
text, zero vectors — deterministic, never fake intelligence). The interfaces
mirror the Vercel AI SDK's call shape **without depending on it** — the SDK
churns majors faster than projects are stamped, and an unused `ai` dependency
is supply-chain surface (ADR 0044) for the many projects shipping no AI. The
mechanical SDK adapter and the pgvector convention (extension migration,
drizzle `customType` vector snippet — destined for `@repo/db/columns` once it
has two consumers — embeddings table sketch with model-id pinning + HNSW
index, job-not-inline pipeline) are README recipes.

### 5. API keys (design note — deliberately OFF)

Better Auth's `apiKey` plugin stays **off** per ADR 0033's policy (the 2025
unauthenticated-key-creation CVE; exact pin + advisory watch). The shape for
the project that needs it: enable the plugin _after reviewing its advisories
at that date_; keys carry **scopes** (`resource:action` strings checked by a
guard next to `SessionGuard` — deny-by-default, a key without the scope 403s)
and a **throttle tier** (per-key rate config riding the plugin's
`rateLimit`/metadata, enforced alongside the ADR 0035 Redis throttler, keyed
by key id, not IP). Keys are tenant-scoped from day one (ADR 0041's owner
column), erasable (ADR 0040), and auditable (creation/revocation are audit
rows). None of this ships now: an unreviewed crypto-adjacent surface enabled
"for later" is exactly the risk the 0033 policy exists to prevent.

## Consequences

- The contract statement is now explicit: schema changes in
  `@repo/validators` are wire-contract changes — reviewed as such, caught by
  the OpenAPI snapshot gate.
- The three seam modules are intentionally **unwired** (nothing imports them;
  tests keep them honest). Their READMEs are the feature spec a project
  follows — the skeleton's suite stays free of demo-ware.
- The webhook signature scheme is pinned by a known-vector test: an
  accidental change to the signed-string format breaks the build, not
  production receivers.
- A provider/SDK choice (billing, AI) becomes one adapter class + one
  composition-point edit per project; nothing downstream of the interfaces
  moves.
- Accepted cost: seams can rot if recipes drift from reality — each README
  names the code it must stay consistent with (outbox/queues conventions,
  ADR 0032 schema conventions), and the first consuming project is the
  verification.
