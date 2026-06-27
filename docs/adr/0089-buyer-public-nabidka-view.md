# ADR 0089 — Buyer-facing public nabídka view

**Status:** Accepted (2026-06-27). The buyer-facing read deferred by ADR 0083/0087:
a no-session, shareToken-credentialed web route that renders the SAME branded §92e
nabídka the rep prints (now with the complete ADR-0088 supplier block) plus
accept/decline. The load-bearing decision is the trust boundary — the document is
built SERVER-SIDE off the frozen snapshot and returned alone, so cost/margin,
re-derivation seeds, and I3 stamps never cross to the unauthenticated buyer. No
schema change; no new dependency.

## Context

ADR 0083 shipped the public `POST /v1/quotes/shared/:token/{accept,decline}` path
(the unguessable `shareToken` IS the bearer credential — no session, throttle
10/min) but no way for the buyer to SEE the offer; ADR 0087 shipped the branded
`NabidkaDocumentView` but only behind the authed `/quotes` prefix; ADR 0088
completed the supplier block. The missing piece is a buyer-reachable VIEW.

The only structural gap was a READ endpoint: `QuotesPublicController` had
accept/decline but no `GET`. The hazard in adding one is data exposure — the
frozen `QuoteSnapshot` carries the org's **cost/margin** (`costMoney`/`costTotals`,
ADR 0059), the re-derivation seeds (`site`/`inputs`), and the I3 `stamps`. Shipping
the snapshot to an unauthenticated token holder — even "stripped" — risks leaking
margin by omission-mistake.

## Decision

**The backend builds the `NabidkaDocument` and returns only it** — the buyer never
receives the snapshot.

- **`GET /v1/quotes/shared/:token`** on the existing `QuotesPublicController` (no
  SessionGuard; inherits the class `@Throttle(10/min)`). `getSharedNabidka` loads
  the row by token (the existing scope-less unique lookup), then runs the pure
  `buildNabidka` (ADR 0085) over the FROZEN snapshot — `Pick<SiteResult,"bom"|"money">`
  - the frozen `tax`/`supplier`/`customer` — the SAME function + frozen inputs the
    rep print route uses, so the document is byte-consistent with issue (I3, no
    re-derive). `NabidkaDocument` carries **no cost** by construction; the response
    DTO (`sharedNabidkaSchema`) strips anything beyond it (allowlist + belt). So
    cost/margin, `stamps`, `site`/`inputs` never reach the buyer — asserted by an
    integration test that greps the raw payload for the cost golden + the seed keys.
- **Envelope** `{document, status, validUntil}` — the effective status (so the view
  gates accept/decline and shows an accepted/declined/expired banner) + validity.
- **Read does NOT 409 a non-issued quote** (deliberate divergence from
  accept/decline): a buyer who opens an emailed link must always SEE their offer,
  with a status banner — a hard 409 would be a confusing dead end. A `shareToken`
  exists only on an issued-or-later quote, so a resolvable token never surfaces a
  draft; an unknown token 404s; a malformed/price-blind snapshot fails closed (404).
- **Web** — a PUBLIC route at **`/nabidka/[token]`**, deliberately OUTSIDE the
  `/quotes` protected prefix so the proxy auth gate (a `startsWith` allowlist) lets
  it through with no proxy change. The RSC fetches via the cookie-less
  `createPublicServerApiClient` and hands the document to a client leaf. The leaf
  reuses `NabidkaDocumentView` verbatim (now with an optional `actions` slot + an
  optional `backHref` — additive, the authed route is behavior-preserved), composing
  the accept/decline bar into the no-print toolbar; status advances locally on a
  successful resolution (the mutation returns the new status — no authed cache to
  invalidate). Accept/decline ride a SEPARATE `createPublicQuotesQueries` so the
  unauthenticated surface can never pull a session-scoped query.
- **No schema change** — `snapshot` stays `z.unknown()` passthrough; the new
  `nabidka*`/`taxBreakdown`/`sharedNabidka` zod schemas mirror the existing
  `@repo/renderers` `NabidkaDocument` for a typed, stripped response.

## Consequences

- **The trust boundary is the architecture.** Building server-side and returning
  only the document means an unauthenticated caller structurally cannot receive
  cost/margin/stamps — stronger than snapshot-field stripping, which leaks by
  forgetting. The rep print route keeps building client-side (it already holds the
  full snapshot from the authed detail fetch); two callers of one pure
  `buildNabidka`, no divergence.
- **Buyer sees prices, never cost.** Correct — it is the buyer's own quote;
  `NabidkaDocument` carries selling prices and no cost line.
- **PII posture unchanged.** The buyer sees only their OWN frozen identity (ADR 0086) via their own token; no new PII is introduced. Consistent with ADR 0071 —
  the open retained-field-set/period question is unchanged by this slice.
- **Render-taste** (the buyer page chrome — minimal vs branded landing) owed to
  Martin's eye; built functional on the existing document surface.

Related: ADR 0083 (shareToken accept/decline — the credential), ADR 0087 (print
surface M — the view reused), ADR 0085 (renderer L — `buildNabidka`), ADR 0086/0088
(frozen buyer/supplier — what the document shows), ADR 0059 (cost layer — what must
not leak), ADR 0018 (BFF/public RSC client), ADR 0055/0041 (org scope — bypassed by
the token credential), CORE_SPEC I3/I4.
