# ADR 0082 — Customer entity (odběratel) + per-rep ownership

**Status:** Accepted (2026-06-26 — Phase A, the legal-document spine).
**Implementation:** Implemented (the `customer` module + `quote.customer_id`).
The exact GDPR export/erase semantics + the retained-field-set/period are
**legal-gated (non-blocking)** — flagged below.

## Context

Phase A needs a buyer entity: a quote must attach an **odběratel** to be a real
document, and the §92e decision (ADR 0080) needs the buyer's VAT-payer status.
Two forces: the buyer is **PII** (name/IČO/DIČ/address/email), and a CPQ with
multiple reps must NOT expose every rep's deals + customer PII to every rep.

## Decision

- A `customer` module scaffolded via `pnpm gen module` and **flipped from the
  stale owner-scoped template to org-scoped** (ADR 0055): `organizationId`
  (NOT NULL) is THE access scope; `ownerId` is the owning rep.
- **Per-rep ownership layered ON TOP of the org scope** (never replacing it):
  `scoped(scope, {restrictToOwner})` always filters by org and, for a non-admin
  rep, additionally by `ownerId = self`. admin (incl. the org owner, which maps to
  admin) sees the whole org; sales sees only its own. The SAME narrowing is added
  to the **quotes** module (list/get/verify) — else the quotes list leaks every
  rep's deals. Workshop is 403 on the customer surface (price-blind, no buyer data).
- **PII (ADR 0040/0071):** the identifying columns are `pii()`-wrapped (drives
  GDPR export/erasure awareness + log redaction). DELETE **anonymizes the buyer
  PII in place + archives** (never a hard delete) — so an issued quote that froze
  the buyer fields keeps re-deriving (I3). `quote.customer_id` is **ON DELETE
  RESTRICT** (the I3-frozen reference); `customer.owner_id` is RESTRICT (user
  erasure anonymizes the user row, never cascade-deletes org customers, ADR 0055).
- **customer → quote:** `issue` accepts an optional `customerId`, ownership-
  validated through `CustomersService` (404 on another rep's / missing). When
  present, the buyer's `vatPayer` **auto-fills the §92e decision**; the resolved
  tax MODE is frozen in the snapshot (ADR 0080), so re-derivation never re-reads
  the mutable customer — I3 holds.
- **GDPR handler (platform-user keyed):** export returns the rep's _linkage_ to
  the customers they created (ids + timestamps), NOT the buyer PII (a third
  party's, which must not land in a rep's personal export); erase is a NO-OP (org
  data retained; the rep's PII anonymized centrally on the `user` row). The
  buyer's own Art.17 erasure is the customer DELETE flow (anonymize-in-place).

## Consequences

- Cross-module: `QuotesModule` imports `CustomersModule` (a read through the
  owning service, never a schema join). `quote.customer_id` FK lives in the db
  package (like `quote.project_id`), not an api-module schema join.
- **FLAGGED for legal confirmation (non-blocking):** (a) the exact retained-PII
  field-set on an issued document + the statutory period (5 vs 10 y — ADR 0071);
  (b) whether a rep's Art.20 export should carry any buyer PII at all (currently
  linkage-only); (c) IČO/DIČ as personal data for sole traders (registered as
  pii() to be safe). Validation: IČO carries its mod-11 check; DIČ matches
  `CZ\d{8,10}` (`@repo/validators/primitives/cz`).

Related: ADR 0080 (§92e — the customer feeds the VAT-status), ADR 0071
(anonymize-not-delete + I3 retention), ADR 0055 (owner→org scope), ADR 0040
(privacy/audit plumbing), CORE_SPEC I3. Roadmap: [vault] Decision —
enterprise-readiness gap analysis & phased roadmap (Phase A).
