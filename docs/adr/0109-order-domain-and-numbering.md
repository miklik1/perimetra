# ADR 0109 — The order domain: a reference entity over the accepted quote, and the shared document-number allocator

**Status:** Accepted (2026-07-14). Implemented: order entity + state machine +
production re-home + the shared `document_number_sequence` allocator (CAR-156);
quote revision / supersession chains + order re-point (CAR-158). Realizes the
whole of ADR-O1 (drafted in the vault
"2026-07-11 Release plan — Perimetra — deep pass" §2.2/§2.3/§2.6). Builds on the
quote spine (ADR 0053 issue/freeze, ADR 0079 gap-free numbering, ADR 0083
lifecycle, ADR 0101/0108 production projection) and the org-scope seam
(ADR 0041/0055). First R2 (order→cash) slice.

## Context

The end state is configure → quote → **order** → cash on one frozen truth. The
quote spine froze the commercial artifact (an immutable snapshot + stamps, a
status machine, a gap-free per-org/year number), but nothing represented "the
deal we are executing," and the workshop production/traveler surfaces hung off
quotes — conflating an _offer_ with an _obligation_. The research
(`2026-07-13 Research — competitive reference feature set`) confirmed this is
Perimetra's single biggest structural gap: every incumbent turns a quote into an
order, and the CZ order→cash chain is legally mandatory, not optional.

CORE*SPEC I3 forbids any frozen thing from changing. So the order must be built
\_around* the frozen quote, never by copying or mutating it.

## Decision

**1. `order` is a thin REFERENCE entity, never a second frozen truth.** It holds
`quoteId` (→ `quote.id`, `ON DELETE RESTRICT`), an operational `orderNumber`, a
`status`, and an optional `cancelReason`. It carries **no snapshot column** — the
commercial truth stays in exactly one place (the quote it points at). `ownerId`
and `organizationId` are `RESTRICT` (not the generic-scaffold `cascade`): an
order is an I3-adjacent legal artifact that must survive a user/org deletion
(GDPR erasure anonymizes the user row instead, ADR 0071).

**2. One LIVE order per quote is structural.** A partial-unique index
`order_quote_active_uq ON (quote_id) WHERE status <> 'cancelled'` makes it
impossible to have two live orders for one quote; a cancelled order does not
strand the quote (a new order becomes creatable). A concurrent-create race
resolves to one winner + one 409 `order_exists` at the storage layer.

**3. The state machine is `confirmed → in_production → completed`, with
`cancelled` reachable from either non-terminal state**, enforced by a pure
`order-lifecycle.ts` (action-specific predicates `canStart`/`canComplete`/
`canCancel`, mirroring `quote-lifecycle.ts` — no generic transition table, no
clock-derived status) plus server-side actor gates: the workshop drives
start/complete (admin may too); **cancel is admin-only and requires a reason**
(audited). Creation guards the referenced quote is effectively `accepted` (the
ADR 0083 derived read, via `QuotesService` — a cross-module read, never a schema
join, ADR 0032), org-scoped.

**4. The workshop production/traveler surface re-homes to orders with zero data
migration.** `GET /v1/orders/:id/production` resolves order → quote → frozen
snapshot and reuses the existing price-blind projection (`production.ts`)
**verbatim** — the response is byte-identical to the quote-keyed read (I3
untouched). `GET /v1/quotes/:id/production*` stays live (N−1). Orders are
org-visible to every role (the workshop works from orders, not quotes), so the
production view has no owner narrowing.

**5. Order events are IDs-only outbox events** (`order.confirmed`,
`order.production_started`, `order.completed`, `order.cancelled`) emitted in the
same `@Transactional()` tx as the state change (ADR 0037), named for the
federation horizon (ADR-O1: they fold into the hub later) and broadcast to the
`org:<id>` channel (ADR 0055).

**6. The gap-free numbering allocator is generalized to a shared
`document_number_sequence(organization_id, series, year, last_number)`** with a
`NumberingService.allocate(scope, series, year)` — the ADR 0079 atomic
upsert-and-increment, run inside the caller's issue tx (no gap on rollback,
serialized under the `(org, series, year)` PK row lock). The order series
(`"order"`, formatted `Z{year}/{seq:04d}`) is its first consumer. The quote
counter migrates into this table at ADR-O2/CAR-157 (its own slice) so the shipped
I3 quote path is untouched here; `quote_number_sequence` is dropped in a later
contract migration. The order number is **operational**, not statutory (§29
gapless numbering governs tax documents, i.e. invoices — hence the `Z` prefix,
not the quote's bare `{year}/{seq}`).

**7. Quote revision = a new re-derived snapshot + a linear supersession chain
(CAR-158).** `POST /v1/quotes/:id/revise` re-runs the full issue path (a shared
private `issueQuoteRow` core the golden reproduce tests still cover) to freeze a
NEW snapshot stamped `revisionOfId`, and supersedes the old in the SAME tx via a
CONDITIONAL update (`WHERE superseded_by_id IS NULL`) — so a revise-vs-revise
race resolves to one winner + one 409 `quote_already_superseded` (the loser's new
quote and its allocated number roll back together — no gap, no orphan). The new
number continues the same gap-free series. `superseded_by_id` is UNIQUE (a
revision supersedes exactly one predecessor); nullable, so many live heads
coexist. The superseded quote's buyer token keeps rendering the old document (with
a `superseded` banner flag) but REFUSES resolution — a distinct 409
`quote_superseded`, because supersession is a pointer, not a status, so the
`canBuyerResolve` status gate alone would leak the accept/decline. Order re-point
(`POST /v1/orders/:id/repoint {quoteId}`) is legal ONLY from `confirmed` and only
to an `accepted` FORWARD member of the order's supersession chain (a server-side
`supersededById` walk); from `in_production` it 409s (`order_not_repointable`) —
the exception ledger records reality instead of a silent swap.

## Consequences

- ADR 0083's "only the status field moves on the quote row" widens to "status +
  `supersededById` move" (CAR-158); the frozen snapshot stays byte-identical, so
  a revised or superseded quote still reproduces forever (I3). The order half
  changes nothing on the quote row.
- **A cancelled in-production order strands real cut material.** v1 offers no
  material-return workflow (honest gap); the deviation ledger records the
  cancellation as an exception at ADR-O4/CAR-159 (the order-cancel path will
  write that row once the ledger table exists).
- **One live order per quote** means parallel partial orders off one quote are
  impossible in v1 (a split = revise into two quotes at CAR-158) — an accepted
  simplification for the single-org v1.
- Two counter tables coexist transitionally (`document_number_sequence` +
  `quote_number_sequence`) until O2-a consolidates them — a bounded expand phase,
  not two permanent allocator code paths.
- The web workshop surface must re-key its production list/route to orders
  (`confirmed|in_production`) to complete "the workshop sees orders, not quotes";
  the API re-home lands here, the web re-key is the paired follow-on.

## Alternatives rejected

- **Order copies the quote snapshot** — two frozen truths that drift; the exact
  worst-case I3 violation the reference design exists to prevent.
- **Mutable quote with a version column** — edits history; violates the founding
  contract (I3).
- **A generic `canTransition(from, to)` table** — the house idiom
  (`quote-lifecycle.ts`) is single-purpose predicates; a 4-state machine reads
  clearly as three `can*` guards, and inventing a transition matrix diverges from
  the reference module for no benefit.
- **A second parallel counter table per document class** — two allocator code
  paths to keep honest forever; one `document_number_sequence` with a `series`
  column is the correct shape while the row count is tiny (Martin's standing rule:
  refactor cost is not a counterweight).
- **Free order re-point at any state** — silently changes what the workshop is
  building; re-point is confined to `confirmed` at CAR-158, otherwise the
  exception ledger records reality.
