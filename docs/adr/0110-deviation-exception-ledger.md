# ADR 0110 — The deviation/exception ledger: materialize the query, keep the truth frozen

**Status:** Accepted (2026-07-14). Implemented (CAR-159). Realizes ADR-O4
(drafted in the vault "2026-07-11 Release plan — Perimetra — deep pass" §2.9).
Builds on ADR 0048 (the cascade/overrides model + the pure `exceptionLedger`/
`recurrenceReport` in `packages/engine/src/ledger.ts`), the org-scope seam
(ADR 0041/0055), the frozen quote snapshot (ADR 0053, I3) and the order domain
(ADR 0109). Third R2 slice.

## Context

`CORE_SPEC` §4/§7 want every quote-scope deviation, margin-floor breach and
production exception on ONE queryable ledger — the vendor's ETO→CTO promotion
signal ("this same deviation on five quotes → author it into the next release").
ADR 0048 made `exceptionLedger`/`recurrenceReport` pure queries over `Override`
rows, but the overrides live INSIDE each quote's frozen snapshot: any
cross-quote question ("what deviated this quarter?") means loading every
snapshot — fine for fixtures, wrong for an operating business.

## Decision

**1. `deviation_ledger` is a REBUILDABLE write-through PROJECTION, not a legal
record.** Rows are written in the SAME transaction as their source act:

- **`quote_override`** — quote issue projects the frozen quote-scope override
  set (a pure `projectQuoteOverrides(quoteId, snapshot)`; a no-op for the common
  override-free quote, so the golden reproduce tests are unaffected);
- **`margin_override`** — the admin margin-floor override writes a row alongside
  its existing audit entry (ADR 0056/0059);
- **`order_exception`** — written directly (order cancel-from-`in_production`
  auto-writes one; the explicit `POST /v1/orders/:id/exceptions` records
  substituted material / site deviation).

The FROZEN snapshots stay the only truth; the org FK CASCADEs and rows are
disposable — deliberately weaker durability than quotes/invoices. A lost
projection is repairable; a lost quote is not.

**2. Rebuild by construction.** `POST /v1/quotes/rebuild-deviations` (admin,
ADR-O4's "maintenance command") re-projects the snapshot-derivable rows: it
clears the `quote_override` rows and re-runs `projectQuoteOverrides` over every
frozen snapshot, atomically. The authoritative `margin_override` (audit-backed)
and `order_exception` (no other source) rows are left untouched. Drift is
repairable, never silent forever. Orchestrated by `QuotesService` because it
owns the snapshots — which keeps the module dependency strictly ONE-WAY
(quotes/orders → ledger; the ledger never imports them, so there is no cycle).

**3. The recurrence report reuses the engine verbatim.** `GET /v1/ledger?target=
&from=&quoteId=` returns the filtered rows + a recurrence report: the
`quote_override` rows are mapped back to minimal `Override`s and fed to the pure
`recurrenceReport` (ADR 0048) — one source of the promotion-queue logic, engine
and ledger. Admin-only: the ledger carries margin-override values (price-bearing),
so it is not a workshop surface.

**4. Layer split (the deep-pass §8.4 correction): the ENGINE enforces, the
LEDGER records.** Deviation bounds (release-data `deviation` specs, gate
machinery) are enforced in `packages/engine`; CAR-28's FIL tolerance VALUES land
as release data. This module only records + reports — no bounds logic, no
approval chain (cut #4; a one-step approve slots onto this same table as a state
if ever vetoed).

## Consequences

- Dual-write (audit + ledger) for margin overrides is redundant BY DESIGN: audit
  is the tamper-evident trail, ledger is the product-intelligence query. They
  answer different questions; the rebuild command arbitrates any doubt toward the
  snapshots (for the derivable subset).
- Ledger rows are CASCADE-deletable (a projection, not a legal record) — a quote
  or org deletion takes its deviation rows with it. `order_exception` rows have
  no rebuild source, so they are authoritative-until-cascaded (accepted for v1).
- The order-cancel path now writes the stranded-material exception ADR 0109's
  consequences promised — closing that loop.
- `value`/`kind`/`target` are nullable because only `quote_override` rows carry a
  target grammar; margin/order rows use `reason` (+ `value` for the margin figures).

## Alternatives rejected

- **Ledger as the source of truth** — two truths and the drift class I3 exists to
  kill; the projection defers to the frozen snapshots.
- **Querying snapshots on demand** — O(all quotes) per report; correct but
  unusably slow at business volume.
- **A full deal-desk approval workflow** — cut #4, deferred with a pre-scoped
  fallback (a state on this table), not built.
- **Re-deriving the engine to enforce bounds here** — bounds are the engine's
  job (I1–I11); the ledger is a document-layer projection that never re-runs the
  engine.
