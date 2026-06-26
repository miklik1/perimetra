# ADR 0084 — Quotes web surface (list / detail / issue / verify)

**Status:** Accepted (2026-06-26 — Phase A, the legal-document spine).
**Implementation:** Implemented (`apps/web/app/quotes` + the site-canvas issue
panel). Render-taste (weights/sizes/pairing/accent) is owed to Martin's eye — a
specimen artifact is published; not a build blocker.

## Context

The entire quotes backend (immutable I3 store, server-side `deriveSite`,
`verifyReproducibility`, the §92e/DPH tax breakdown, per-rep scope, the
shareToken lifecycle) was **built and unreachable** — the "Q" in CPQ had no UI.
This slice makes it reachable, on the brand kit (ADR 0072/0078), not the
skeleton's plain chrome.

## Decision

- **App-side query libs** (`lib/quotes-queries.ts`, `lib/customers-queries.ts`)
  mirroring `createProjectsQueries` (ADR 0007): list (keyset infinite), detail,
  the I3 `verify` action, `issue` + customer list/create. MSW handlers + fixtures
  in `@repo/api-mocks` (quotes: list/detail/verify/issue/accept/decline;
  customers: list/create) so the surface renders in mock mode + vitest.
- **`/quotes`** (per-rep list — document number + status badge + total) and
  **`/quotes/:id`** (detail), RSC-prefetched as the user, gated by the proxy
  prefix + `<AuthGuard>`. Branded on the Part-A neutral system: a warm `bg-field`
  canvas, matte `bg-chrome` `Panel`s, the Amulya data face for numbers, the
  single copper accent (amber stays reserved for the deviation signal — never a
  status). Status badges: issued = copper (live), accepted = neutral, the rest
  quiet outlines.
- **The detail is the daňový-doklad view**: the structured per-rate tax breakdown
  (net → VAT → gross, ADR 0080), with §92e rendering as a **no-VAT-line document +
  the mandatory legend** (not a 0 % rate). Plus a **reproducibility panel** that
  reframes `verifyReproducibility` as a customer-facing **trust feature** (ADR
  0083 positioning) — a button re-derives the frozen quote and shows ✓ reproduced.
- **Issue flow** (configure → attach customer → issue) lives on the **site
  canvas** (the configurator at site scope): an `IssueQuotePanel` (sales/admin
  only — workshop is price-blind + 403) with a customer picker + inline create + a
  §92e construction/assembly toggle. The buyer's VAT status auto-fills §92e
  server-side (ADR 0082); issue POSTs the configured site+roster (already the
  issue-ready save shape) and navigates to the frozen quote.

## Consequences

- Nav: `/quotes` added to the proxy `PROTECTED_PREFIXES`, the navigation
  registry, and an account-page link. i18n `quotes` namespace (cs + en).
- No backend change — this is pure web + mocks (the api was complete after ADR
  0080–0083). The web tests run on MSW (list/detail/§92e-legend/verify-trust).
- **FLAGGED for Martin (render-taste, not a blocker):** display weights/sizes,
  Chillax/Synonym/Amulya pairing balance, the copper accent intensity, the
  detail layout proportions — calibrate against a GPU render + the live page
  (`WEB_PORT=3002 pnpm dev` → `/quotes`). A specimen artifact is the starting point.
- Deferred: a richer issue wizard (the panel is functional, not a multi-step
  flow), quote revisions/supersession (Phase B), the buyer-facing public VIEW of a
  shared quote (pairs with the PDF slice).

Related: ADR 0080 (tax breakdown rendered here), ADR 0082 (per-rep scope +
customer), ADR 0083 (lifecycle + the verify-as-trust framing), ADR 0072/0078
(brand kit + fonts), ADR 0007/0018 (the query + mock patterns). Roadmap: [vault]
Decision — enterprise-readiness gap analysis & phased roadmap (Phase A).
