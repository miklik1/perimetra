# lookups — public-register lookups (ADR 0090)

Outbound-lookup module (no schema, no repository, no outbox, no worker). Proxies
two PUBLIC registers behind the api so the web can prefill / validate a customer
or supplier identity:

- **ARES** (Administrativní registr ekonomických subjektů, MF ČR) —
  `POST /v1/lookups/ares` `{ ico }` → name / registered seat / DIČ.
- **VIES** (EU VAT Information Exchange System) —
  `POST /v1/lookups/vies` `{ dic }` → VAT-payer validity (the §92e both-parties
  condition's evidence).

These are reads, but **POST** carries the lookup key in the BODY, never the URL —
keeping the IČO/DIČ (a `pii()` value) out of the request log (pino-http logs
`req.url`, not the body), browser history, and proxy access logs. `@HttpCode(200)`
makes them honest reads, not the POST-default 201.

**Fail-soft is the contract.** An upstream outage/timeout/parse-failure returns
`unavailable` (and ARES `not_found` on a 404) — never an exception. The lookup is
a typing convenience; it must NEVER block manual customer entry. VIES
`unavailable` is deliberately distinct from `invalid` (a member-state outage must
not read as a bad number). A malformed key is a client error (`400`), checked
before any outbound call so a bad request can't spend upstream quota.

## Public surface

- `GET /v1/lookups/ares/:ico` (admin/sales) — `AresLookup`.
- `GET /v1/lookups/vies/:dic` (admin/sales) — `ViesLookup`.
- `LookupsService` — internal; not exported (no cross-module consumer).

## Must never

- Own or import another module's schema (`@repo/db/schema/*`) or a repository —
  this module owns no persistence. The only `@repo/*` deep import is
  `@repo/validators/lookups` (response shapes + the IČO/DIČ input primitives).
- Import `OutboxModule` or emit events / enqueue jobs — it performs no writes and
  puts nothing on Redis (no PII leaves the request path).
- Log the IČO/DIČ being looked up, or put it in the URL/query (where pino-http's
  `req.url` would capture it) — a sole-trader IČO is quasi-personal and the
  customer columns are `pii()`; the key goes in the POST body, logs carry only
  status/HTTP codes.
- Call an upstream without a bounded `AbortSignal.timeout` — a hung register must
  not pin a request.
- Be imported BY `AuthModule` (or any module it depends on): the dependency
  direction is inbound-only (this module → Auth, never the reverse).

Governing ADRs: 0090 (this module), 0032 (cross-module reads), 0041/0055
(tenancy), 0056 (RBAC).
