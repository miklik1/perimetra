# ADR 0088 — Org legal-profile + supplier-identity snapshot freeze

**Status:** Accepted (2026-06-27). Completes the nabídka loop: the supplier
(dodavatel) block that ADR 0087 left as a flagged placeholder is now real data,
modeled as an org-scoped singleton and FROZEN onto the issued document. No new
dependency. The exact §29-ZDPH mandatory field-set + the OSVČ-PII posture are
legal-gated (flagged below); the structure is built, the constants are provisional.

## Context

A complete CZ daňový doklad (§29 ZDPH) legally requires the supplier's identity —
name, IČO, DIČ, registered seat, the court-registration note, a payment account.
ADR 0087 shipped the print surface with a "complete the company profile"
placeholder because the fabricator's legal identity was UNMODELED — neither the
`NabidkaDocument` (ADR 0085) nor any org entity carried it. The §92e tax decision
(ADR 0080) also hard-coded `supplierVatPayer: true` at issue, a latent assumption.

ADR 0086 established the pattern for an issued document's parties: the BUYER
identity is FROZEN into the immutable snapshot (a captured fact, retained through
Art.17, excluded from the I3 `checks`). By symmetry the SUPPLIER block on an
issued tax document is also a legal record that must reproduce forever and must
NOT change when the org later edits its profile.

## Decision

**An org-scoped singleton `legal_profile`** (one row per org), authored by org
admins, and FROZEN into the quote snapshot at issue — symmetric to the buyer.

- **Data model** — a new module-owned table `legal_profile` (NOT the Better-Auth
  `organization` table, which is BA-owned/off-limits): `organizationId` NOT NULL +
  UNIQUE (the singleton key) + `ON DELETE cascade`; `ownerId` the creator/last-
  editor audit ref (`ON DELETE restrict`, the ADR-0055 anonymize-not-delete
  stance); `name` NOT NULL; `ico/dic/vatPayer/addressLine/city/postalCode/country/
bankAccount/registrationNote`. **NOT `pii()`-wrapped** — this is the fabricator's
  BUSINESS identity, not a natural person's data; wrapping would wrongly route
  org-identity into Art.17 erasure. Migration is purely additive (CREATE TABLE),
  N−1 safe; existing orgs start with an honest empty state.
- **Singleton API** — `GET /v1/org/legal-profile` (returns `{profile: …|null}` — a
  not-yet-completed org is `null`, an empty state, not a 404) + `PUT` (full-document
  upsert, idempotent → no `@Idempotent`), **admin-gated** (`@RequireRole("admin")`;
  BA `owner`→`admin`). Sales/workshop are 403'd from the LIVE surface; they never
  need it (the issued nabídka reads the FROZEN copy, and `issue()` loads the profile
  server-side regardless of the caller's role).
- **The freeze (the I3 piece)** — `issue()` loads the org profile and freezes a
  `supplier {name,ico,dic,vatPayer,address…,country,bankAccount,registrationNote}`
  block into the snapshot beside the buyer block. A captured fact, so it is ABSENT
  from `verifyReproducibility` `checks[]` — a quote re-derives byte-identically even
  after the org edits (or never touches) its live profile. The supplier's
  `vatPayer` now drives `resolveTaxMode` (retiring the hard-coded `true`); the mode
  is itself frozen, so verify re-reads the frozen mode (existing quotes unaffected).
- **No supplier profile ⇒ 422 `legal_profile_required`.** A complete daňový doklad
  cannot omit the supplier block, so issue is a hard refusal (not a silent
  placeholder) until the org completes its profile. The seed provisions a demo
  profile so the dev org issues out of the box.
- **Renderer L + print M** — `NabidkaDocument` gains a `supplier: NabidkaSupplier |
null` field (threaded through `buildNabidka` options as pure data); the print
  surface renders the populated block (falling back to the ADR-0087 placeholder
  only for a legacy pre-slice quote). **Web** — an admin-gated form at
  `/team/legal-profile`.

## Consequences

- **New hard precondition on issue.** After this slice an org must complete its
  legal profile before issuing any quote (`422 legal_profile_required`). Correct —
  no supplier identity, no valid daňový doklad — but a real workflow gate (the seed
  and every issuing test set a profile first).
- **I3 risk near-zero.** The only re-derived-value change is the §92e `mode` source
  (now the profile's `vatPayer`), and the mode is frozen in `snapshot.tax.mode`,
  which verify re-reads — so existing quotes reproduce unchanged. The frozen
  supplier itself is a captured fact, never compared.
- **LEGAL-GATED (provisional, flagged):** (a) the EXACT §29-ZDPH mandatory field-set
  — in particular whether a statutory-rep / contact-person field is required (that
  WOULD be a natural person's PII → a `pii()` column + schema change); (b) the OSVČ
  sole-trader posture (a sole trader's name/IČO ARE personal data — the same open
  ADR-0071 retention gate); (c) whether `bankAccount` is mandatory. The structure
  ships; these constants are confirmable without a schema rewrite.
- **Render-taste** (field grouping/layout of the form + the supplier block) owed to
  Martin's eye — built functional on the brand kit.

Related: ADR 0086 (buyer freeze — the mirror pattern), ADR 0087 (print surface —
the gap this closes), ADR 0085 (renderer L), ADR 0080 (§92e tax / `vatPayer`),
ADR 0055/0041 (org scope), ADR 0071 (immutable-PII retention), ADR 0040 (PII
registry), CORE_SPEC I3/I4.
