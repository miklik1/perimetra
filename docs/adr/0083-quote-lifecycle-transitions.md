# ADR 0083 — Quote lifecycle transitions + buyer acceptance

**Status:** Accepted (2026-06-26 — Phase A, the legal-document spine).
**Implementation:** Implemented (status transitions + the public shareToken
accept/decline path; expiry derived on read).

## Context

The quote status enum (`draft/issued/accepted/expired`) was a **dead enum**: a
quote was created `issued` and never moved, and the `shareToken` was stored but
**unread** — there was no way for a buyer to accept. The roadmap's "close the
loop" needs a real, guarded state machine and a buyer-acceptance path.

## Decision

- **Lifecycle:** `draft → issued → accepted` (or `→ declined`), with `expired`
  **derived, never stored**:

  ```
  draft ──issue──▶ issued ──accept (buyer/shareToken)──▶ accepted
                      │
                      └──decline (buyer/shareToken)─────▶ declined
  ```

  `issued` past `validUntil` **reads as `expired`** (`effectiveStatus`, a pure
  function of the clock) — so no cron/worker is needed and the lapse is exact.
  `accepted`/`declined` are terminal (a resolved deal does not expire). `draft`
  is reserved for the future revision/draft-quote feature; the current flow
  creates `issued` directly.

- **`declined` added** to `QUOTE_STATUSES` (validators + db, in lockstep). The
  column is `text` (no PG enum), so this is **no migration** — just the tuples.

- **Buyer acceptance via `shareToken`** — a public (unauthenticated)
  `QuotesPublicController` at `/v1/quotes/shared/:shareToken/{accept,decline}`.
  The unguessable random-UUID token IS the bearer credential (no session/org).
  Legal only from an _effectively_ `issued` quote (`canBuyerResolve`) — a lapsed
  or already-resolved quote 409s. The global `ThrottlerGuard` applies, tightened
  with `@Throttle(10/min)` against token-guessing. The response is a minimal
  acknowledgement (`{documentNumber, status}`) — never the priced snapshot.

- **I3 untouched:** only the `status` field moves; the immutable snapshot/stamps
  are never rewritten, so a re-derive/verify still reproduces. Acceptance is
  `@Transactional()` + audited with a `null` actor (an external buyer, not a
  platform user); a no-op second resolution 409s rather than re-auditing.

## Consequences

- Reads (list/get) map through `effectiveStatus`, so the UI sees `expired`
  without a stored mutation. Per-rep scope (ADR 0082) still gates the authed
  reads; the public accept path is scope-less by design (token-authed).
- The buyer-facing VIEW of a quote (the document the buyer reads before
  accepting) is the quotes-web / PDF surface (a later slice) — this ADR ships the
  transition + the accept/decline ACTIONS, integration-covered (accept/decline/
  double-resolution-409/expired-409/unknown-token-404 + derived-expiry on read).

Related: ADR 0053 (the quote store), ADR 0082 (per-rep scope), ADR 0080/0081
(the frozen tax/money the document carries), CORE_SPEC I3. Roadmap: [vault]
Decision — enterprise-readiness gap analysis & phased roadmap (Phase A).
