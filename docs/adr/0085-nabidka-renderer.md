# ADR 0085 — Nabídka renderer (pure-data L layer; PDF surface split out)

**Status:** Accepted (2026-06-26 — Phase A, the legal-document spine).
**Implementation:** L layer **Implemented** (`packages/renderers/nabidka.ts`,
golden-tested). The thin PDF/print **surface (M)** + the customer-identity
snapshot freeze are **flagged for the next session** (see below).

## Context

A CZ nabídka / daňový doklad is the document the whole Phase-A spine exists to
ship. Per the roadmap it is **split L/M**: a pure-data renderer in
`packages/renderers` (off the derived result, I4, no I/O — testable as data) and
a thin presentation surface in app-land (the PDF/print binary). This ADR ships
the L layer; the renderers package already follows exactly this discipline for
the cut list / 2D drawings / 3D scene.

## Decision

- **`buildNabidka(site, result, { documentNumber, tax, customer })` →
  `NabidkaDocument`** — a pure function over `(Site, SiteResult)` + the frozen
  §92e/DPH tax breakdown (ADR 0080) + the buyer + the gap-free document number
  (ADR 0079). It emits header + priced line items (the rolled-up BOM) + per-
  category net subtotals + the structured tax document (per-rate net→VAT→gross +
  the §92e legend) + net/VAT/gross totals. Everything is already I10-canonical
  (engine money strings + the frozen tax breakdown), so a nabídka built off a
  **re-derived** quote is byte-identical to the one issued (I3).
- **Golden-tested** in `@repo/fixtures` on the REAL derived site: standard 21 %
  (net 129891.5 → VAT 27277.22 → gross 157168.72), the §92e variant (no VAT
  line + the mandatory legend), and determinism (re-derive → identical).
- **Brand reference:** a specimen of the branded document (the M-layer target —
  Chillax/Synonym/Amulya on the Part-A neutral palette, the tax table, the
  reproducibility-as-trust panel, the §92e legend) is published as an artifact
  for render-taste calibration.

## Consequences

- The renderer is presentation-free: the PDF/print surface draws this shape.
- **FLAGGED for the next session (the M layer + a prerequisite):**
  1. **Customer-identity snapshot freeze** — at issue, the quote freezes only
     `customerId` + the resolved tax MODE (ADR 0082); for a legally-retained
     document (ADR 0071) the buyer-identifying fields must be **frozen into the
     snapshot** so the nabídka shows the buyer as-of-issue even after the live
     customer is anonymized. Small backend add (snapshot is JSONB — no
     migration); not I3-compared (frozen reference data, not a derived artifact).
  2. **Thin PDF/print surface (M)** — a branded `/quotes/:id/nabidka` print route
     (`@media print`, the app's already-CSP-clean self-hosted woff2 — no new
     font load) or a server-rendered PDF; the buyer-facing public view pairs with
     the shareToken (ADR 0083). Deferred so the binary-generation choice +
     font-embed get fresh context (it's the riskiest, taste-bearing half).

Related: ADR 0080 (the tax breakdown rendered), ADR 0079 (document number),
ADR 0082 (customer), ADR 0071 (retained buyer identity), ADR 0072/0078 (brand),
CORE_SPEC I4/I10/I3. Roadmap: [vault] Decision — enterprise-readiness gap
analysis & phased roadmap (Phase A, the split PDF nabídka).
