# ADR 0090 — ARES/VIES registry lookup

**Status:** Accepted (2026-06-27). A read-only, fail-soft api proxy over two PUBLIC
registers — the Czech **ARES** (IČO → name/sídlo/DIČ) and the EU **VIES** (DIČ →
VAT-payer validity) — wired into the customer-create and supplier legal-profile
forms as IČO-prefill + a DIČ-validity badge. No persistence, no schema change, no
new dependency (native `fetch`). The load-bearing decisions are **fail-soft** (an
upstream outage degrades the convenience, never blocks manual entry) and the
**`unavailable` ≠ `invalid`** distinction for VIES (a member-state outage must not
read as a bad number, since VIES validity is the evidence for the §92e
both-parties-VAT-payer condition).

## Context

A rep typing a buyer (odběratel) or the org's own supplier identity re-keys data
that already lives in the public CZ business register. Two registers help:

- **ARES** (Administrativní registr ekonomických subjektů, MF ČR) —
  `GET https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/{ico}`,
  no auth, returns `obchodniJmeno` / `sidlo` / `dic` / `datumZaniku`.
- **VIES** (EU VAT Information Exchange System) —
  `GET https://ec.europa.eu/taxation_customs/vies/rest-api/ms/{cc}/vat/{number}`,
  no auth, returns `isValid` / `name` / `address` / `userError`.

VIES is **load-bearing for §92e** (ADR 0080): reverse charge applies only when both
parties are CZ VAT payers, so confirming a DIČ is real matters. But both registers
have downtime, and VIES proxies to national systems that frequently return
`MS_UNAVAILABLE`. A naïve integration that errored on outage — or that read
`MS_UNAVAILABLE` as "invalid" — would either block customer entry or silently deny
a legitimate reverse-charge.

The api had **no outbound-HTTP test harness** and no precedent for a query-only
module that owns no persistence.

## Decision

**A new `lookups` module — controller + thin service, no schema/repository/outbox.**
The shape precedent is `PlatformModule` (orchestration-only, ADR 0062); the
fail-soft fetch precedent is `RealtimeService`; the bounded-timeout precedent is the
webhook dispatcher.

- `POST /v1/lookups/ares` `{ ico }` → `AresLookup` = `{ status: "found" |
"not_found" | "unavailable", ... }` (subject fields present only on `found`).
- `POST /v1/lookups/vies` `{ dic }` → `ViesLookup` = `{ status: "valid" |
"invalid" | "unavailable", name?, address? }`.
- Guards `SessionGuard` + `RolesGuard` + `@RequireRole("admin","sales")` (the same
  commercial surface as customers; workshop 403). No `@CurrentScope()` — a pure
  public-register proxy touches no org-scoped table. `@Throttle({ttl:60s,limit:30})`
  caps per-user rate so the endpoint can't be turned into an upstream-quota
  battering ram (ARES is 500/min per IP).

**Fail-soft is the contract.** Upstream 5xx / timeout (`AbortSignal.timeout`, ARES
3 s / VIES 5 s) / parse-failure → `unavailable`; ARES 404 → `not_found`. The service
NEVER throws on an upstream condition. A **malformed key** is the one exception — it
is a client error (`400 invalid_ico` / `invalid_dic`), validated by the shared CZ
`ico`/`dic` primitives BEFORE any outbound call, so a bad request can't spend
upstream quota.

**`unavailable` is deliberately distinct from `invalid`** (VIES): only a definite
`userError === "INVALID"` is reported invalid; `MS_UNAVAILABLE` / any other code /
timeout reads as inconclusive. A red "invalid" badge on an outage would wrongly
deny §92e.

**No PII leaves the request path.** No Redis, no jobs (synchronous inline). The
endpoints are **POST with the lookup key in the BODY, not the URL** — so the
IČO/DIČ (a `pii()` value) is **never written to a log line**: pino-http's
`autoLogging` serializes `req.url` but not the request body, and a body field named
after a `pii()` column is redacted by `buildRedactPaths` regardless (ADR 0040). The
service's own log lines carry only status/HTTP codes, never the key. (The review
caught that a GET with the key in the path WOULD land it in the production request
log — hence the body.) They are reads, so `@HttpCode(200)`, no `@Idempotent`.

**Web.** `aresPrefill` (pure) maps a `found` result onto form fields; the customer
inline form (`issue-quote-panel`, `useState`) sets name + DIČ, the supplier
legal-profile form (RHF, `setValue`) sets name + DIČ + sídlo. A `<ViesBadge>` (pure
`viesTone` + presentational) shows the DIČ validity, gated reactively on a
well-formed DIČ. **`vatPayer` is NOT auto-set** from a valid VIES result — it stays
the rep's explicit toggle (preserving the deliberate ADR 0082 design where `dic` is
supporting evidence, not the trigger). Auto-suggesting it is a flagged follow-up.

## Alternatives considered

- **Discriminated-union response schemas** (strongest "no-leak by construction").
  Rejected mechanically: nestjs-zod's `createZodDto` cannot extend a union type. The
  responses are flat objects with a `status` enum + optional data fields; the
  **service** is the no-leak guarantor (it never populates data on a degraded
  status) and the strip-serializer + a unit test back it.
- **Background job / cache.** Rejected — a lookup is a synchronous typing aid; a job
  would put the IČO/DIČ on Redis (PII) for no benefit.
- **Auto-flip `vatPayer` on a valid VIES.** Rejected — overreaches the rep's
  explicit choice; the §92e mode is frozen at issue from `vatPayer`, so a silent
  flip is a correctness hazard. Advisory badge only.
- **ARES `country` from `sidlo.kodStatu`.** Simplified to `CZ` (ARES is the Czech
  register; foreign-seat subjects are an edge case) — flagged, not load-bearing.

## Consequences

- New env: `ARES_BASE_URL` / `VIES_BASE_URL` (`z.url()`, default = the production
  URL — no local equivalent; overridable for a corporate proxy or a test double).
  No credentials → not in the production-forbidden-defaults set.
- New `@repo/validators/lookups` contract (+ eslint allow-list; **no** db-schema
  entry — the module owns no persistence). OpenAPI snapshot regenerated (additive).
- `@repo/api-mocks` gains a `lookups` route group so mock-mode dev exercises the
  prefill UI without the public registers.
- **I1–I11 untouched.** No engine/money/snapshot path is touched; goldens reproduce.
- The api now makes an authenticated outbound call to two public registers. It is
  rate-capped, timeout-bounded, fail-soft, and PII-quiet; a register outage is a
  no-op for the rep (manual entry is unaffected).

## Flagged (non-blocking)

- The legal constants for §92e remain accountant-gated (ADR 0080/0081); VIES
  confirms a DIČ is real but the tax-mode decision is unchanged by this slice.
- Auto-suggesting `vatPayer` from a confirmed VIES result is a deferred UX call.
