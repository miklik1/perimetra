# ADR 0120 — The Nabídky (quotes) surface reskin: the o-LIST list and the §3.2 quote-document detail

**Status:** Accepted (2026-07-21 — W7 Phase 2, surface 2, delivered through HQ's
reskin-wave boot). Follows [ADR 0119](0119-orders-surface-reskin.md) (which
established the wave method and the per-surface fixes) and applies the design
authority ([ADR 0114](0114-design-canvas-adoption.md)) to the internal quotes
surface. `design/README.md` §3.2 is the detail's content contract; §5/§6 govern
scope; §12 is the ship bar.

## Context

The internal Nabídky surface has **no canvas board** — §6 names it a "§5 gap-fill
in the canvas's spirit, drawing on the Zakázky list language for the index and
the Nabídka document language for the detail." So the list is designed to match
the orders o-LIST table shipped in ADR 0119 (internal-list consistency), and the
detail is designed to §3.2 in the language of the Nabídka document boards
(`design/Perimetra Nabidka.html`, `design/configurator/frames-quote.jsx`).

Unlike orders, the detail was already substantial: it rendered the header, the
buyer share link (`/nabidka/:shareToken`), the §92e/DPH tax document, and the
reproducibility trust panel. The reskin polishes that working behaviour to the
document language rather than rebuilding it, and adds the §3.2 gap-fills the
scaffolding lacked: the revision-lineage indicator and the aggregated site BOM.

The BOM is the sensitive piece. §3.2 requires "the aggregated site BOM with
per-instance provenance," and the frozen snapshot carries it (`snapshot.bom`, a
`SiteBomLine[]`) — but a BOM line carries `totalPriceMoney`, so surfacing it is a
**price-blindness question**, not merely a layout one.

## Decision

Two slices, LOOK + honest gap-fill, no schema change:

1. **The `/quotes` list** — reskinned to the ADR 0119 orders o-LIST table
   language (a bare accessible `<table>`, uppercase muted heads, hairline rows,
   per-row hover, one stretched-link anchor per row → `/quotes/:id`), inside the
   settings-layout idiom with the per-branch min-h fix. Honest columns: document
   number, status (the server `effectiveStatus`, never re-derived), total, and
   validity. **The total column is the honest divergence from orders** (quotes are
   priced) and renders only behind a `quote.total !== null` gate.

2. **The `/quotes/[id]` detail** — the §3.2 quote document. The header is the
   Nabídka titleband (eyebrow + document number + meta cluster + `border-b-2
border-primary`); the tax document and the BOM use the shared `.price` table
   treatment (uppercase muted heads, hairline rows, a `border-t-2 border-primary`
   spotlight total row, the gross in copper); the buyer-link and trust panels are
   polished to the document register. Added: a registry-derived breadcrumb
   ("Nabídky › {documentNumber}"), the revision-lineage indicator, validity in
   the header, and the aggregated site BOM.

The mercata method drove it (spec → i18n-seed → two disjoint builders → cold gate
→ adversarial review → skeptic → fix). The i18n keys were seeded by a sequential
first agent so the two parallel builders never collided on the catalogs. The
adversarial pass — instructed to hunt hardest for a workshop price leak through
the new BOM — found **zero** defects; the price boundary was independently
re-verified.

## The BOM price-blindness boundary (the load-bearing decision)

The aggregated BOM ships, protected by a **two-boundary, coinciding gate** —
defense in depth, not a front-end hide:

- **Server:** for a workshop viewer, `blindSnapshot` (`quotes.service.ts:393`)
  copies each BOM line as `{componentCode, name, unit, category, quantity,
sources}` and **drops `totalPriceMoney`**, drops the `money`/`totals` rollups,
  and `toSummary` nulls `total`. The money field is **not on the wire** for
  workshop.
- **Client:** `quote-detail.tsx` narrows `totalPriceMoney` as **optional** and
  renders the BOM's Cena column — both its `<th>` and every `<td>` — only behind
  the same `quote.total !== null` gate the top-line total uses. Component, name,
  unit, category, quantity, and per-instance provenance render always; money never
  renders unpriced. A gate regression cannot surface a value that is absent from
  the payload.

Category subtotals, when shown, come from `snapshot.money` (present only for a
priced viewer) — client-side money-string arithmetic over `totalPriceMoney` is
never done (banned).

## Recorded deviations from the export (§11.2)

1. **The list reuses the orders o-LIST table language** (no quotes board exists,
   §6). Columns are contract-honest: document number, status, total (price-gated),
   validity — chosen over `createdAt` because expiry is the quote-relevant signal
   and status already reflects it.
2. **The revision-lineage indicator links by ID, with a generic label.**
   `quoteSummarySchema` carries only `revisionOfId`/`supersededById` (UUIDs), not
   the sibling's document number, so the "Zobrazit novější revizi" / "Revize
   předchozí nabídky" links resolve by ID; fetching the sibling's number is a
   deferred second round-trip.
3. **The detail reuses existing working behaviour, polished — not rebuilt.** The
   header, buyer-link, §92e tax document, and reproducibility trust panel keep
   their logic; only their presentation moved to the Nabídka document language.
4. **`text-green-700` → `text-success`** — the reproduced-OK state used a raw
   Tailwind palette color; replaced with the token (§12.2 no-raw-color).
5. **The per-branch `min-h` fix** carries from ADR 0119 (authed `<main>` drops
   `min-h-screen`; the bare `AuthGuard` fallback keeps it).
6. **The buyer-facing `/nabidka/:token` "Nabídka Online" surface is NOT this
   slice.** It is the separate Phase 3 rebuild (board `frames-quote.jsx`
   q-DESKTOP/q-MOBILE/q-ACCEPTED); this ADR is the INTERNAL quotes list + detail.

## Consequences

- No schema change; I1/I3/I5 untouched; no backend behaviour changed.
- Price-blindness net preserved and extended: the list and detail carry their own
  absence assertions, and a real `total: null` workshop fixture (empty
  blind-snapshot, mirroring the server allow-list) was added to the mocks so the
  "never renders Kč" assertions run against a genuine price-blind row.
- Eyes-on cleared in both themes at all six ship-bar widths: the list (varied
  status badges, priced Celkem column), and the full §3.2 detail — titleband,
  superseded-revision lineage, §92e Daňový doklad, the aggregated site BOM with
  per-instance provenance (SESTAVY: fenceA/fenceB/gate) and the price-gated Cena
  column, and the Ověřitelná nabídka trust panel. No horizontal body scroll; dark
  resolves fully. Only console noise is the known local realtime drift. A reusable
  `capture-quotes.mjs` instrument is added.
- The full gate is green: check-types, lint, web vitest (537 tests), build, knip.
