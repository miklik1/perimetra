# ADR 0087 — Thin PDF/print nabídka surface (the M layer)

**Status:** Accepted (2026-06-27). Closes the nabídka loop: the L-layer pure-data
renderer (ADR 0085) now has a presentation surface. No backend change, no new
dependency. Render-taste (weights/scale/accent) is owed to Martin's eye — built
to the Part-A brand hierarchy; a specimen artifact is the calibration target.

## Context

ADR 0085 shipped `buildNabidka(...) → NabidkaDocument` (pure data, I4). ADR 0086
froze the buyer identity onto the snapshot. The remaining gap: the document had
no way to be SEEN or printed — the "Q" in CPQ produced no deliverable sheet.

The repo carries ZERO PDF dependency (deliberate). A browser print-to-PDF off a
branded HTML route is the thin surface: no binary renderer, the ADR-0078 fonts
are already self-hosted at the app origin (so the strict CSP `font-src 'self'`
holds for the printed sheet), and the layout reuses the existing brand tokens.

## Decision

A web print route **`/quotes/:id/nabidka`** (RSC) + a presentational
`NabidkaDocumentView`:

- **RSC builds off the FROZEN snapshot, no re-derive.** The page fetches the
  quote server-side (per-rep scope, cookie forwarded) and calls `buildNabidka`
  with `snapshot.site` + `{bom, money}` + `{documentNumber, tax, customer}` —
  all frozen at issue. So the printed sheet is byte-consistent with the issued
  quote (I3) without re-running the engine. `buildNabidka`'s `result` param was
  narrowed to `Pick<SiteResult, "bom"|"money">` (backward-compatible) so the
  snapshot feeds it directly.
- **Presentation in app-land** (the renderers discipline): `NabidkaDocumentView`
  lays out the `NabidkaDocument` as an A4 sheet — header + document number, buyer
  block (the ADR-0086 frozen identity), priced line items, per-category net
  subtotals, the structured §92e/DPH tax document (rate lines + totals + the
  no-VAT-line §92e legend), on the Part-A neutral system (warm field / white
  sheet / single copper accent on the gross). `window.print()` → PDF; `@page` +
  `print:` utilities strip the toolbar and chrome for the sheet.
- **Fails closed for the price-blind workshop.** The workshop snapshot projection
  (ADR 0056) carries no `tax`/`money`, so the route 404s for that role — the
  priced nabídka is not theirs to render.

## Consequences

- **KNOWN GAP — the supplier (dodavatel) block is a flagged placeholder.** The
  org legal profile (fabricator name/IČO/DIČ/address) is not modeled — neither
  the `NabidkaDocument` (ADR 0085) nor any org entity carries it. The surface
  renders an explicit "complete the company profile" placeholder; a complete
  legal daňový doklad needs an **org-legal-profile slice** (the next follow-on).
- **Buyer-facing public view deferred.** This surface is the authed rep's
  deliverable. The buyer (shareToken) view of the nabídka is a clean follow-on
  on the same `NabidkaDocumentView` behind the public token path (ADR 0083).
- Render-taste pass owed to Martin (specimen artifact published).

Related: ADR 0085 (nabídka renderer L), ADR 0086 (buyer freeze), ADR 0078 (brand
fonts), ADR 0072 (brand tokens), ADR 0080 (§92e tax), ADR 0056 (price-blind),
CORE_SPEC I3/I4.
