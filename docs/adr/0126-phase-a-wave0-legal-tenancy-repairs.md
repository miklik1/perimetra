# ADR 0126 — Phase A Wave 0: fail-closed at issue, one live order per deal, per-rep invoices, and the envelope's `details` slot

**Status:** Accepted (2026-07-24 — Phase A, Wave 0). The repair set that precedes the invoice surface. Scope came from the W10 Phase-A readiness audit (vault: `Proposal — Phase A execution plan (2026-07-24)`, which re-scopes the enterprise-readiness roadmap against the shipped code) — it found that Phase A is mostly built — but that four of its already-shipped pieces are wrong in ways that only matter once a real fabricator sends a real document.

## Context

Phase A's goal sentence is "a salesperson configures a site, attaches a customer, issues a legally-correct CZ quote … and sends a branded re-derivable document the buyer can view and accept". Auditing that sentence against the code found the _attach a customer_ step unenforced, the _legally-correct_ claim overstated on a customer-facing surface, and two boundaries (order-per-deal, invoice visibility) that were correct in the abstract and wrong in the concrete.

The unifying rule this ADR establishes: **Phase 2's contract-honesty inverts on a legal document.** A _view_ may honestly subtract — omit the widget no backend backs (ADR 0119–0125). An _issue_ may not: a missing field on a numbered, frozen commercial document is not honesty, it is a defective document. So the Phase-A pattern is to **fail closed at issue, with a typed 422, before a gap-free number is burned** — which the invoice module (ADR 0112) already did and the quote path did not.

## Decision

### 1. A quote cannot be issued without an odběratel — 422 `customer_required`

`customerId` was optional at issue and the printed nabídka degraded to a "no customer" placeholder, so a rep could freeze and gap-free-number a buyerless "offer". Quote issue now refuses it, in the same shape as the `legal_profile_required` guard already in that method, **before** any allocation.

`customerId` stays **optional in the zod schema** and required by the service. This is deliberate: a required schema field fails as an untyped body-validation error, while the surface needs a typed code to route the rep to "attach a customer" — the invoice precedent. `revise()` re-runs the issue path, so the guard applies there too, and the whole transaction rolls back on refusal (an itest pins that the original is _not_ superseded when a revise 422s). The "just price it" workflow is unaffected: the configurator prices a site before issue.

Consequence: `input.tax.customerVatPayer` is now vestigial (the attached customer's flag always wins). Marked as such on the wire rather than removed.

### 2. A non-VAT-payer supplier cannot ship a VAT-bearing offer — 422 `supplier_not_vat_payer`

The backstop existed only at invoice issue, so the _customer-facing_ offer was the unprotected one. Same code string, same `standard_vat && ratePct > 0` shape as `invoices.service.ts`.

### 3. One live order per DEAL, not per quote row

`assertAcceptedForOrder` checked `effectiveStatus === "accepted"` and never `supersededById`, and `order_quote_active_uq` is keyed on `quoteId` — while `revise()` mints a _new_ quote row. A rep could therefore raise one live order against an accepted quote and a second against its accepted revision: two live, separately gap-free-numbered orders for one deal.

- A superseded quote is not orderable: 409 `quote_superseded`, checked before the accepted check.
- A new `chainQuoteIds()` seam walks the revision chain (`revisionOfId` back, `supersededById` forward) and `findLiveByQuoteIds()` refuses a second live order anywhere on it: 409 `order_exists_for_chain`, carrying the incumbent order number so the refusal is actionable.

**We did not ban revising an accepted quote.** That was the obvious reading of the audit finding and it is wrong twice over: `QuotesService` cannot read orders without inverting the module DAG (`orders → quotes` is one-way), and more fundamentally the existing re-point path (ADR-O1 / CAR-158) _requires_ a newer accepted revision to exist — only `revise()` can mint one, so a ban would break re-point by construction. The rule is enforced one call later instead: the revision exists, and it is not independently orderable while the incumbent order lives.

### 4. The number-series year is Prague's, not the server's

Quote and order numbering read `new Date().getFullYear()` — the server clock, UTC in every container we ship — while the invoice series takes its year from the DUZP. For the first hour of the Czech new year (Prague 00:00–01:00 on 1 January, still 31 December in UTC) a quote or order therefore numbered into the _closed_ old-year series. A shared `numberingYear()` in the numbering module (the allocator both callers already own) pins the wall clock to `Europe/Prague`; the invoice path deliberately keeps its DUZP-derived year, which is a fact read off the document rather than a clock. Unit-tested at the boundary instant.

The numbering module also gained the `CONTEXT.md` it never had.

### 5. Invoices are read per rep, not per org

`invoices.repository.scoped()` filtered `organizationId` only, so a sales rep who is correctly 404'd from another rep's customer and quote could list any invoice in the org and read that buyer's name, IČO, DIČ, e-mail and address out of the `facts`/`snapshot` JSONB. Now narrowed on `invoice.owner_id` (the issuer, stamped at freeze per ADR 0055), mirroring ADR 0082's customers pattern exactly — admin unrestricted, everyone else own-only, **404 not 403** so non-existence never leaks. Every cross-module seam that passes `{restrictToOwner: false}` was audited and left deliberate (each returns no buyer PII, or is the scope-less outbox path).

**I3 is untouched**: this changes _which rows are readable_, never what is frozen or how it re-derives. Pinned twice — an admin verifying another rep's invoice still gets `reproduced: true`.

### 6. The error envelope's `details` slot is actually forwarded

`apiErrorEnvelopeSchema` declared `{message, code?, details?, errors?}` from the start, but `GlobalExceptionFilter` only ever copied `message`/`code`/`errors`. **No typed rejection's context has ever reached a client.** The live casualty: quote issue threw `site_invalid` with a top-level `issues[]`, so the `IssueList` branch the issue panel is built around was unreachable in a browser — the rep saw a bare message where the I5 issues should be.

The filter now forwards a plain-object `details`, `site_invalid` moves its issues into that slot, and the web reader follows. One slot, not an open passthrough of the thrown body: context thrown anywhere else is still dropped (deliberately), which is now pinned by the filter's first-ever test.

### 7. A nabídka is not a daňový doklad

The DPH breakdown panel was titled **"Daňový doklad"** on the rep detail, the print view **and the public buyer landing**. A nabídka is structurally not a §29 tax document: its own number series, no DUZP, no payment block, and its VAT is computed net→VAT bottom-up where the invoice kernel is §37 top-down (they can differ by a haléř). Renamed to `quotes.vatBreakdown` — cs **"Rozpis DPH"**, en "VAT breakdown". "Rekapitulace DPH" was rejected: that is precisely the heading Czech accounting software prints _on_ a daňový doklad, so it re-imports the connotation the rename exists to remove.

The issue panel follows the new contract: no "no customer" option, the action disabled with a visible, `aria-describedby`-announced reason, and the five typed 422s the issue path can throw mapped to Czech titles + remedies through the existing `siteInvalidIssues` mechanism (no second error-mapping scheme).

### 8. `korunaToHalere`'s float boundary: documented, not closed

The last hop before an amount becomes an invoice line is `roundHalfAwayFromZero(Number(mulMoney(koruna, "100")))`. Closing it would mean re-deriving the kernel's rounding rule inside `@repo/model` — a duplicate that silently drifts the day the kernel changes, traded for a bound that is already provable. So it stays, with the precondition spelled out and **tested**: a tripwire that fails if `roundingPolicy.scale` is ever raised above 4, a sweep of all 100 post-scaling fractions across five magnitudes against an exact BigInt reference, and a pin that the exact ×100 is load-bearing. The audit's premise that "the input is already 2dp" is false in general — a scale-3/4 price table really does produce more — which is why the bound is stated in terms of the scale cap instead.

## Consequences

- **Test harness:** the mandatory buyer rippled through 11 integration suites that issued customer-less quotes. A shared buyer helper in the itest harness now attaches a same-org customer; no assertion was weakened.
- **Adversarial review** (3 lenses — correctness, tenancy, legal honesty — each finding then put to a refute-by-default skeptic): 18 findings raised, 13 refuted, 5 confirmed and all fixed here — the broken itest suites, the dropped `details` (both halves), an off-by-one-hour rationale in the numbering-year comments (the code was right, the prose described a window in which both clocks agree), and this ADR's own absence while 28 code comments already cited it.
- **⚠️ Follow-ups (none blocking, all named for the invoice wave):**
  1. **Revise past re-point.** Revising a quote whose order is already `in_production` (past `canRepoint`) still mints a revision that can never be reconciled onto that order. Closing it wants a `deal_id` chain root or the ADR-0063 hook-registry port — a schema decision, deliberately not made here.
  2. **Invoice `facts`/`snapshot` are outside the `pii()` registry** and the module registers no privacy handler, so GDPR export/erasure and log redaction do not see that buyer PII. This narrowing is an access-control fix and must not be read as a redaction fix; the invoice `CONTEXT.md` now says so and points at ADR 0071, which governs why the answer is not simply "register and erase".
  3. `quote_not_accepted` and `margin_below_floor` still carry context outside `details`, which the envelope drops. No consumer needs it today.
  4. 14 of 29 api modules still have no `CONTEXT.md` — `quotes` and `orders`, the two most invariant-dense, among them.
  5. Deferred contract migrations (both want a migration already in flight): dropping the dead `draft` quote status, and dropping the legacy `quote_number_sequence` table.
