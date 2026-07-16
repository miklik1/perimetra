# Inbound provider webhooks that recover tenant scope (recipe)

Extends the webhook-to-outbox ingestion recipe in `README.md` for the harder
case: a callback that must first work out WHICH owner/org it belongs to (no
session, and on a public storefront possibly no host either), then write scoped
state under that recovered scope. The base recipe covers the signed-JSON
subscription callback; this one covers a gateway/marketplace transaction
callback that carries only the provider's own reference id.

Drained from mercata's ComGate (`card_online`) webhook (its ADR 0098). **Read
this whole file before adapting mercata's code** — mercata was written for a
repo that ALSO carries an RLS-by-GUC tenancy floor (mercata's own ADR) that
**this skeleton deliberately does not have**: ADR 0107 rejects RLS/FORCE-RLS
here because a session GUC is unsafe under this skeleton's transaction-pooling
mandate (ADR 0038). Do not copy mercata's `SYSTEM_DB`/`BYPASSRLS` role or its
`set_config('app.current_org', …)` call — there is no GUC to set in this
skeleton. Everything below is the same SHAPE, translated onto the app-level
scoped-repository seam this skeleton actually has (ADR 0041).

> If your derived project added its own RLS-by-GUC floor (its own ADR
> superseding 0107, mercata-style), use mercata's recipe directly instead — the
> two are not interchangeable.

## 1. `@Public()` is mandatory here — say why

This skeleton's `SessionGuard` is a global default-deny `APP_GUARD` (ADR 0099):
every route is authenticated UNLESS it carries `@Public()`. Unlike a codebase
where omitting `@UseGuards` makes a route public (mercata's model), forgetting
the decorator here means the provider's callback 401s. Put it on the handler
with the justification the decorator's own doc comment asks for:

```ts
// Public by construction (ADR 0099's opt-out): the callback carries no session.
// The provider's shared secret / signature IS the auth, verified below before
// any DB access.
@Public()
@Post()
@HttpCode(200)
async ingest(@Req() req: FastifyRequest): Promise<string> { … }
```

## 2. Recover the owning scope via an unscoped `*System` repository read

The callback carries the provider's own reference id (mercata: `transId`), not a
userId/orgId. Resolving it needs ONE query with no `scoped()` filter — the
skeleton already has this exact shape for worker/system code,
`ProjectsRepository.findByIdSystem()`
(`apps/api/src/modules/projects/projects.repository.ts`):

```ts
async findByIdSystem(projectId: string): Promise<ProjectRow | null> {
  const [row] = await this.txHost.tx
    .select().from(project)
    .where(and(eq(project.id, projectId), isNull(project.deletedAt)))
    .limit(1);
  return row ?? null;
}
```

Your webhook module's repository gets the equivalent, e.g.
`findByGatewayTransactionIdSystem(provider, gatewayTransactionId)` — a plain
unscoped `select`, no separate DB role, no `SYSTEM_DB` connection. There is only
ONE Postgres role in this skeleton (ADR 0107); "System" here means "this one
named method skips the ownership filter," NOT "this connection bypasses RLS" —
there is no RLS to bypass. Comment it exactly like `findByIdSystem()`: not for
controllers, one recovery read only.

**No record found ⇒ no-op, 200.** A callback whose reference id matches nothing
WE created is a stale/foreign/forged callback — the floor is "only ever advance
a transaction we ourselves initiated." Never create a record from an inbound
callback; 200 to stop the provider's retries, log, stop.

## 3. Hand-build the `RequestScope` — don't reach for `@CurrentScope()`

`@CurrentScope()` reads `request.sessionContext` and THROWS if the SessionGuard
didn't attach one. A webhook has no session, so build the scope object directly
from the row you recovered, then pass it explicitly into every scoped call —
the same "scope arrives as an argument" contract `request-scope.ts` documents:

```ts
const scope: RequestScope = {
  userId: row.ownerId,
  organizationId: row.organizationId ?? null, // dormant until the ADR 0041 retrofit
};
await this.myRepo.recordWebhookEvent(scope, { … });
await this.myRepo.updateStatusByGatewayTxn(scope, { … });
```

The `scoped()` filter is the same one every other request uses; you feed it a
hand-assembled scope instead of one pulled from a session. This is also why no
"hand-set GUC" step exists here: the scope was never ambient, so there is
nothing to fake.

## 4. Idempotency-insert + status-update + emit — one ordinary `@Transactional()`

Mercata wraps this in a manual `txHost.withTransaction(…)` plus a raw
`select set_config('app.current_org', …)` as the transaction's first statement
(it must set the GUC before any RLS-gated query runs). This skeleton has no GUC
to set first, so the step collapses to the pattern used everywhere else:

```ts
@Transactional() // outbox.emit() requires an active transaction (ADR 0037)
async handleCallback(scope: RequestScope, cb: ParsedCallback): Promise<void> {
  const fresh = await this.repo.recordWebhookEvent(scope, { … }); // idempotency insert
  if (!fresh) return; // redelivery of an already-processed (id, status) — swallow, still 200
  await this.repo.updateStatusByGatewayTxn(scope, { … });
  await this.outbox.emit({
    aggregateType: "…",
    aggregateId: "…",   // ids only (ADR 0037)
    eventType: "…",
    payload: { /* ids only */ },
  });
}
```

The idempotency-ledger shape (`unique(provider, referenceId, status)`,
insert-on-conflict-do-nothing, boolean return short-circuits the caller) and a
monotonic/absorbing status guard (e.g. `WHERE status <> 'paid'` so a reordered
redelivery never clobbers a settled outcome) are NOT RLS-coupled — keep both.

## Path-guarded content-type parser (non-JSON callback bodies)

Some providers POST `application/x-www-form-urlencoded`; Fastify ships no parser
for it. A parser is registered globally on the Fastify instance (there is no
per-route parser API), so guard it by path — every OTHER route must keep its
JSON-only contract and still 415 a urlencoded body:

```ts
app
  .getHttpAdapter()
  .getInstance()
  .addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string" },
    (req, body, done) => {
      if (!req.url.startsWith("/your/webhook/path")) {
        done(Object.assign(new Error("Unsupported Media Type"), { statusCode: 415 }), undefined);
        return;
      }
      try {
        done(null, Object.fromEntries(new URLSearchParams(body as string)));
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );
```

Register in `main.ts` before `app.init()`/`listen()` (this skeleton has no other
`addContentTypeParser` call to sequence against; if your project also registers
`@fastify/multipart`, keep both path-guarded). If the provider signs the raw
bytes, verify over the
RAW string before parsing; if it signs a shared-secret field inside the parsed
params, parse first — use whichever the provider's scheme actually signs.

## The network-in-transaction caveat, generalized

This skeleton has no per-request transaction interceptor — `@Transactional()`
is opt-in per service method (ADR 0037). The caveat still applies at that
granularity: if a `@Transactional()` method makes a synchronous outbound call
mid-method, the method's WHOLE transaction — and any row locks it already took —
stays open for that call's full latency + timeout. Under this skeleton's pooling
doctrine (`poolSize × replicas < max_connections`, ADR 0038) a held connection
during a slow outbound call is a scarce-resource tradeoff, not a free action.
Default stance: keep outbound calls OUT of `@Transactional()` methods (call out
first, persist after; or commit, then react to a failure separately). If you
deliberately want "a gateway failure rolls back the whole business transaction"
(mercata's `initiate()` choice) that is a legitimate call — name it in a comment
at the call site and put a tight timeout on it (mercata used 5s), so it doesn't
happen by accident because an outbound call got added to an already-
`@Transactional()` method later.

## What NOT to port from mercata verbatim

- `SYSTEM_DB` / `BYPASSRLS` role split — one Postgres role here, no RLS (ADR
  0107); use an unscoped `*System` repository method instead.
- `select set_config('app.current_org', …)` — no GUC exists; hand-build a
  `RequestScope` object instead.
- "No `@UseGuards` ⇒ public" — this skeleton is default-deny (ADR 0099);
  `@Public()` is mandatory and must be explicit.
- **Reusable as-is:** the idempotency-ledger insert, the monotonic/absorbing
  status guard, the path-guarded content-type parser, the only-advance-our-own-
  record floor, and the network-in-tx caveat (re-scoped to per-method, not
  per-request).

_Billing is a seam, not a feature (ADR 0034): the skeleton ships no payments
module, schema, or provider adapter. This is a recipe to reach for when a
project adds a provider webhook — not a description of code that exists here._
