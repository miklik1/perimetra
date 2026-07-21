# ADR 0119 — The Zakázky (orders) surface reskin, and the Phase 2 reskin-wave method

**Status:** Accepted (2026-07-21 — decided by Martin, delivered through HQ's W7
Phase 2 boot: "reskin the surfaces, §11 order, top-down"). Applies the design
authority ([ADR 0114](0114-design-canvas-adoption.md)) and the app shell
([ADR 0118](0118-authenticated-app-shell.md)) to the first already-implemented
surface. `design/README.md` §11.1 places `orders` first among the implemented
surfaces ("smallest, and it exercises the shared production coupling"); §5 and §6
govern its scope; §12 is the ship bar it is judged against.

## Context

Phase 1 of the design-canvas adoption built the kit floor, the configurator, and
the authenticated app shell. Phase 2 reskins the surfaces that already exist —
the throwaway low-fidelity scaffolding `apps/web` shipped to prove backend
behaviour (§1.1) — to the canvas LOOK, one surface at a time. This ADR records
the first surface (`/orders`, board `Perimetra Zakazky.html` /
`frames-order.jsx`) and, being first, establishes the method and the two
per-surface fixes every later surface repeats.

The governing tension is **contract-honesty**. The canvas is the LOOK authority,
never a data authority. The Zakázky board draws a customer name, a product name,
a value column, a due date, four money/count KPI tiles, a six-stage lifecycle
timeline, a deposit/balance money strip, and a production batch. The backend has
almost none of that: `orderSchema` is thin — `{ id, quoteId, orderNumber, status,
cancelReason, createdAt, updatedAt }` — its statuses are exactly four
(`confirmed | in_production | completed | cancelled`, not the canvas's six), there
is no aggregate endpoint, and the order detail route is not a sales screen at all
— it is the price-blind workshop production view (`/orders/[id]/production`,
[ADR 0056](0056-membership-scoped-rbac.md) / [ADR 0108](0108-workshop-traveler.md)).
Where the canvas overdraws what the backend can honestly supply, honesty wins and
the divergence is recorded here (§11.2).

## Decision

Two slices, both LOOK-only (no schema change, no new endpoint beyond a thin
existing read):

1. **The `/orders` list** — reskinned to the canvas `o-LIST` look: a bare,
   accessible `<table>` (uppercase muted column heads, hairline-divided rows,
   per-row hover) in place of the Panel-per-row list, inside the settings-layout
   idiom. Each row is one focusable stretched-link anchor (full-row click, a
   single tab stop) carrying the role-split routing unchanged (workshop →
   `/orders/:id/production`, admin/sales → `/quotes/:quoteId`). Loading
   (skeleton), empty (`EmptyState`), and error (`role="alert"`) states are all
   implemented. Only the three fields `orderSchema` carries are shown.

2. **The `/orders/[id]/production` detail chrome** — the page frame, the
   per-branch min-h fix, and a registry-derived breadcrumb ("Zakázky ›
   {orderNumber}"). The shared `ProductionView` body is untouched.

The mercata multi-agent method drove it (spec → two disjoint builders → cold gate
→ adversarial review → per-finding skeptic → fix). The adversarial pass found one
real defect the green gate missed (the breadcrumb leaf showed the quote's
document number, not the clicked order number) — now fixed via a thin,
role-independent, price-blind `GET /v1/orders/:id` read.

## Recorded deviations from the export (§11.2)

1. **The KPI tile row is omitted.** The canvas draws four count/money tiles ("Ve
   výrobě 3", "Čeká na doplatek", "Fakturováno 7/26" …). No aggregate endpoint
   exists, and the list is keyset-paginated — a client can see only the current
   page, so any total or count assembled from it is partial and therefore
   dishonest. A tile that lies is worse than no tile.
2. **The customer, product, value, and due-date columns are omitted.**
   `orderSchema` carries none of them and there is no cross-module join to
   reconstruct them (module boundary, [ADR 0032](0032-module-owns-its-schema.md)).
   The honest table is three columns: order number, status, created date.
3. **The "Export" and "Nová zakázka" actions are omitted.** No bulk-export
   endpoint and no create-order-from-list flow exist (an order is created by
   confirming an issued quote); a button that links nowhere is worse than its
   absence.
4. **The status badge keeps the shipped tone map, not the canvas's.** The canvas
   tints "Ve výrobě" with an info-blue badge; the shipped `order-status.tsx` uses
   copper for `in_production` — a deliberate single-accent decision (copper marks
   the one actively-worked state; amber stays reserved for the deviated-piece
   signal). Weighing §1.1 (export wins) against a documented shipped choice, the
   shipped tones are kept and the divergence recorded here.
5. **The canvas `o-DETAIL` money/customer/activity content is not ported.** The
   six-stage timeline, the deposit/balance money strip, and the
   Aktivita/Výroba/Zákazník tabs belong to a sales view that does not exist:
   `/orders/[id]/production` is the price-blind workshop build sheet. Porting a
   money strip or a customer tab onto it would violate price-blindness by
   construction. The detail reskin is chrome-only.
6. **The breadcrumb and the detail H1 show different identifiers, by design.**
   The breadcrumb leaf shows the order number the user clicked (`Z2026/0002`),
   read from the thin order endpoint. The `ProductionView` H1 still shows the
   underlying quote's document number (`2026/0002`), because `ProductionView` is
   reused verbatim by the priced `/quotes/[id]/production` N-1 surface and cannot
   be changed in a chrome-only orders reskin. The breadcrumb carries the honest
   order-scoped identifier; the H1 remains the production document's evidenční
   číslo.
7. **The `min-h-screen` fix is per-branch, not a blanket codemod.** The
   authenticated `<main>` drops `min-h-screen` (the app shell owns height and
   scroll); the `AuthGuard` fallback keeps it, because it renders bare — outside
   the shell's framed content slot — and must still fill the viewport. This is
   why [ADR 0118](0118-authenticated-app-shell.md) deferred the codemod to a
   per-surface fix: the blanket form is unsafe in the bare/unauth branch.

## Consequences

- No schema change; I1/I3/I5 untouched. No backend behaviour changed, so no new
  integration test was required.
- Price-blindness is preserved and extended: the list's "never renders Kč"
  assertion is kept, and the detail carries its own absence assertion (§12.1
  item 11).
- The shared `ProductionView` is deliberately left un-reskinned. It is the
  canonical build sheet rendered by both the orders detail and the (Phase 3)
  priced `/quotes/[id]/production` surface; reskinning it now would silently
  half-reskin an out-of-scope quotes surface. It is already kit/token-clean, so
  the canvas "panel shells around the cut list and drawing" requirement is
  already met. Its reskin is scheduled with the Phase 3 quotes wave.
- Eyes-on cleared in both themes at all six ship-bar widths (390 / 768 / 1024
  portrait / 1194 / 1280 / 1440): no horizontal body scroll, dark resolves fully
  (no half-flip), no hydration or page errors. The only console noise is the
  known local realtime drift (Centrifugo `allowed_origins` is `:3000` while this
  box's web runs on `:3002`), which is fail-soft and must not be committed away.
  A reusable `capture-orders.mjs` instrument is added.
- The full gate is green: check-types, lint, web vitest (526 tests), build, knip.

The method and the two per-surface fixes (contract-honesty over canvas fidelity;
the per-branch `min-h` fix) carry forward to every later Phase 2 surface.
