# ADR 0112 — Invoice as the second frozen document class, and the `@cardo/tax-cz` seam (ADR-O2)

**Status:** Accepted as design (2026-07-15). This ADR finalizes ADR-O2 (drafted
in the vault "2026-07-11 Release plan — Perimetra — deep pass" §2.4/§2.7) **to
the seam**: it fixes the invoice data model, the numbering consolidation, the
consumer-owned mapper boundary against the shared CZ tax-document kernel, the
payment posture, and the reproducibility harness. The **build lands in slices
O2-a…O2-c below**, each gated on a named blocker; no invoice code ships with this
ADR. Supersedes nothing. Builds on ADR 0109 (order domain + the shared
`document_number_sequence` allocator), ADR 0053/0079/0080/0081/0083/0086/0088
(the quote spine: issue/freeze, gap-free numbering, the `TaxBreakdown`, exact
decimal money, lifecycle, frozen identity), and ADR 0041/0055 (org scope).

Realizes CAR-157 (invoice / §29 daňový doklad), CAR-160 (SPAYD/QR + IBAN + VS),
CAR-192 (the §28 advance-payment chain + §92e + VAT-rate-as-data), and the
document half of CAR-191 (branded customer document). Governed by the HQ ruling
[[Decision — the CZ tax-document kernel is a shared platform capability
(2026-07-14)]] and the 2026-07-15 order-cycle ruling 3 (SPAYD/`buildInvoice`
land in `@cardo/tax-cz`, by the cardo seat).

## Context

The first koruna a fabricator collects needs a **daňový doklad** per §29 ZDPH:
supplier/customer identity, DUZP (datum uskutečnění zdanitelného plnění), a
gap-free evidence number, a per-rate VAT breakdown (or the §92e reverse-charge
no-VAT-line + mandatory legend), and payment identification. The quote spine
already owns every ingredient — the tax structure (`TaxBreakdown`, ADR 0080),
exact decimal money (ADR 0081), a proven gap-free allocator (ADR 0079, now the
generalized `document_number_sequence` of ADR 0109), and frozen supplier/customer
identity capture (ADR 0086/0088). The order domain (ADR 0109) then made "the deal
we are executing" a first-class entity over the accepted quote.

Two things changed the original ADR-O2 draft between 2026-07-11 and now:

1. **The CZ tax-document logic is no longer Perimetra's to write.** Martin's
   2026-07-14 no-duplication ruling extracted Mercata's hardened CZ tax +
   documents modules into the shared platform package **`@cardo/tax-cz`** (cardo
   ADR 0015). Perimetra R2 is the _second consumer_ and **must consume, not
   re-derive** — a second diverging ISDOC/§92e code path is the worst possible
   outcome on a regulated path. The kernel is a pure, framework-free, zero-`@cardo`-
   runtime-dependency leaf; **money is integer haléře** throughout.

2. **The kernel is not yet consumable, and is still growing.** As of 2026-07-15
   `@cardo/tax-cz` is unpublished (no registry release; `workspace:*` does not
   cross repos, and there is no `@cardo/*` in Perimetra's `node_modules`), and the
   invoice-assembly conveniences (`buildInvoice`, `buildSpayd`) are **being added
   this cycle by the cardo seat** (ruling 3) — they do not exist in the kernel
   today. What the kernel already exports and Perimetra will consume:
   - `@cardo/tax-cz` — the VAT math (`computeLineVat`, `computeDocumentTotals`,
     `clearAdvancesByRate`, `roundHalfAwayFromZero`, the `CZ_VAT_RATE_*` consts,
     `CZ_TAXED_REGIMES`) and the §29 primitives (`formatDocumentNumber`,
     `variableSymbolFromNumber`, `regimeForRate`, `checkSection29Issuable`,
     legends, KH codes, `numberingYearFromDuzp`, `retentionUntil`).
   - `@cardo/tax-cz/export` — the **document export seam**: the `Exportable*`
     POJOs (`ExportableDocument` / `ExportableLine` / `ExportableIssuer`), the
     `DocumentExporter.render(doc, issuer)` interface, and the ISDOC / Pohoda /
     UBL exporters + `buildPdfViewModel`.
   - `@cardo/tax-cz/conformance` — `runTaxCzConformance(impl)`, the ADR-0009
     behavioral drift gate a consumer runs in its OWN CI before adopting/updating
     the real dependency.

   The kernel's own seam contract (its `CONTEXT.md`) is explicit: **"Row → POJO
   mapping stays in the consumer. The consumer maps its own schema rows into
   `ExportableDocument`/`ExportableLine`/`ExportableIssuer` and calls
   `exporter.render(doc, issuer)`. Adding a vertical = a new mapper, not a package
   fork."** That mapper is the seam this ADR designs.

`CORE_SPEC` I3 forbids any frozen thing from changing. The invoice must therefore
be built around the frozen quote (never by copying/mutating it) and must itself
freeze into an immutable, re-derivable document — the same discipline the quote
already earns.

## Decision

### 1. The invoice is the second frozen document class

A new immutable `invoice` row (module `apps/api/src/modules/invoices`, schema
`packages/db/src/schema/invoices`) holds two frozen JSONB payloads — **`facts`**
(the exact builder inputs) and **`snapshot`** (the built `ExportableDocument`,
the kernel-rendered output) — plus the denormalized legal/operational columns
needed for lists and guards. It references (never copies) the order and, through
it, the accepted quote's frozen snapshot:

```
invoice
  id                uuid PK (uuidv7)
  owner_id          text NOT NULL → user.id         ON DELETE RESTRICT
  organization_id   text NOT NULL → organization.id ON DELETE RESTRICT
  order_id          uuid NOT NULL → order.id        ON DELETE RESTRICT
  document_number   text NOT NULL                    -- series "invoice", gap-free (§29)
  status            text NOT NULL                    -- "issued" | "paid"
  superseded_by_id  uuid NULL UNIQUE → invoice.id    -- replacement chain (no in-system correction, v1)
  currency          text NOT NULL
  issued_on         date NOT NULL
  duzp              date NOT NULL                     -- semantics accountant-gated (CAR-27 pass 2)
  due_on            date NOT NULL
  variable_symbol   text NOT NULL                     -- digits ≤10, derived (§ Decision 5)
  total_money       text NOT NULL                     -- gross, I10 decimal, denorm for lists
  facts             jsonb NOT NULL                    -- InvoiceFacts (frozen builder inputs)
  snapshot          jsonb NOT NULL                    -- ExportableDocument (frozen builder output)
  paid_at           timestamptz NULL
  paid_note         text NULL
  ...timestamps
  UNIQUE INDEX invoice_org_document_number_uq (organization_id, document_number)
  PARTIAL UNIQUE INDEX invoice_order_active_uq ON (order_id) WHERE superseded_by_id IS NULL
  INDEX invoice_org_id_id_idx (organization_id, id)
```

`owner_id`/`organization_id` are `RESTRICT` (an invoice is an I3-adjacent legal
artifact that must survive a user/org deletion; GDPR erasure anonymizes the user
row instead, ADR 0071), matching the order's durability posture.

### 2. The kernel seam — what Perimetra owns vs. what the kernel owns

The boundary is drawn exactly where the kernel's `CONTEXT.md` draws it:

- **Kernel-owned (`@cardo/tax-cz`, do NOT re-derive):** the VAT math
  (`computeLineVat`/`computeDocumentTotals` — top-down §37 split, half-away-from-
  zero rounding, the §92e reverse-charge and 0-rate handling), the §29 primitives
  (the NUMERIC evidence-number / variabilní-symbol formatting — `formatDocumentNumber`
  and `variableSymbolFromNumber` emit digit strings for the VS, NOT the human
  `FV…/…` series; plus `checkSection29Issuable`, legends, KH codes, `retentionUntil`),
  the ISDOC 6.0.2 / Pohoda / UBL-Peppol serializers behind `DocumentExporter.render(
doc, issuer)`, and `buildPdfViewModel` (a standalone PDF _view-model_ — the heavy
  `@react-pdf` renderer is injected app-side at the composition root, not a kernel
  `DocumentExporter`).
- **Perimetra-owned (the consumer side):** a pure **mapper** from the frozen
  quote snapshot + `InvoiceFacts` into the kernel's `ExportableDocument` /
  `ExportableLine` / `ExportableIssuer` POJOs, plus the **money-unit conversion**
  between Perimetra's I10 exact-decimal koruna strings and the kernel's integer
  **haléře** (this is the sole numeric reconciliation the consumer performs; the
  koruna→haléře rounding uses the kernel's `roundHalfAwayFromZero` so the seam
  never invents a second rounding rule). The mapper is the "new mapper, not a
  package fork" the kernel expects; adding Perimetra as a vertical is exactly
  this file.

Because the kernel is unpublished, the mapper is written against a **local mirror
of the `Exportable*` interfaces** (copied verbatim from `@cardo/tax-cz/export`'s
`snapshot.ts`, kept in lockstep like the `OrgRole`/`ac`-roles duplications already
in this repo), swapped for the real import the moment the package publishes. The
mirror is deliberately NOT built until the kernel's `ExportableDocument` shape is
frozen and `buildInvoice`/`buildSpayd` land (they are in flight this cycle) — see
the STOP boundary (Decision 9); mirroring a moving, unpublished type early would
only buy drift. Where exactly `buildInvoice` sits relative to the consumer mapper
is under-determined until it lands — it may be a thin assembly convenience the
consumer calls after mapping, or it may assemble the `ExportableDocument` itself
(overlapping the mapper the kernel's `CONTEXT.md` assigns to the consumer); that
boundary is pinned at O2-b, not guessed here.

### 3. Numbering consolidation (O2-a) — one allocator, one continuity story

ADR 0109 generalized the ADR-0079 allocator to `document_number_sequence(org,
series, year, last_number)` and used it for the `"order"` series, but the quote
counter still lives in the legacy `quote_number_sequence(org, year)`. O2-a folds
the quote counter in so all three classes share one gap-free allocator:

- **Data (expand):** backfill `INSERT INTO document_number_sequence(organization_id,
series, year, last_number, …) SELECT organization_id, 'quote', year, last_number,
… FROM quote_number_sequence ON CONFLICT DO NOTHING;`
- **Code (switch):** `QuotesRepository.allocateNumber` calls
  `NumberingService.allocate(scope, "quote", year)` instead of touching
  `quote_number_sequence`; `formatQuoteNumber` is unchanged, so issued
  `quote.document_number` strings stay **byte-identical** (the legal series is
  untouched; only the operational counter's home moves).
- **Schema (contract, deferred):** drop `quote_number_sequence` in a later
  contract migration once nothing reads it.

Safe because ADR 0079 itself classifies the counter as _operational state, not a
legal artifact_, and the immutable `quote` row keeps its `(organization_id,
document_number)` UNIQUE backstop — so the worst a counter-home race can produce
is a retryable 409 or a gap, never a duplicate legal number. The **human/legal
document number** stays a Perimetra-local per-class formatter: a new
`formatInvoiceNumber` → `FV{year}/{seq:04d}` (**PROVISIONAL, accountant-gated**,
CAR-27 pass 1) joins the shipped `formatQuoteNumber` (`{year}/{seq:04d}`) and
`formatOrderNumber` (`Z{year}/{seq:04d}`) — NOT the kernel's `formatDocumentNumber`,
which emits a pure digit string for the variabilní symbol, not the `FV…/…` series.

### 4. `InvoiceFacts` and the mapper boundary

`InvoiceFacts` is frozen into `invoice.facts` at issue and is the _exact_ input to
a re-run of the build:

```ts
interface InvoiceFacts {
  quoteId: string; // the frozen commercial basis (immutable row)
  documentNumber: string;
  issuedOn: string;
  duzp: string;
  dueOn: string; // ISO dates
  // Tax inputs FROZEN AT INVOICE ISSUE — §21 ZDPH ties the rate to DUZP, not to
  // quote time, so a VAT-law change between quote and invoice must be expressible
  // without touching frozen history:
  ratePct: string; // default: the quote's stamped price-table rate;
  //          an explicit override on issue is audited
  mode: TaxModeKind; // default: copied from the quote snapshot; override audited
  rounding: RoundingPolicy; // copied from the quote's frozen tax.rounding
  // Identity captured LIVE at issue (§29 wants the supply-time parties; the quote's
  // frozen blocks remain the OFFER's record):
  supplier: FrozenSupplierIdentity; // org legal profile incl. IBAN
  customer: FrozenCustomerIdentity; // 422 fail-closed if the live customer was GDPR-anonymized
  payment: { iban: string; variableSymbol: string };
}
```

The mapper carries the quote's **already-frozen** per-rate `TaxBreakdown` (ADR 0080)
GROSS amounts (converted to haléře) as the line inputs rather than recomputing from
live tables, and feeds those grosses into the kernel's `computeLineVat`/
`computeDocumentTotals` for the `VatSummaryRow[]` + totals the `ExportableDocument`
carries. Only the **gross** is carried across: the kernel re-derives base/VAT
top-down (§37, `base = gross·100/(100+rate)`), whereas the quote's breakdown was
built bottom-up (`vat = net·rate/100`) — for the same gross the two can disagree by
a single haléř on the base/VAT split, so the invoice's printed net/VAT is the
§37-correct top-down figure and need not equal the quote's frozen split (the Σgross
payable is identical). **VAT-rate-as-data (CAR-192):** the rate is never a code
constant — it originates on the quote's stamped price-table (`dphRate`) and flows
into `InvoiceFacts.ratePct`; the kernel's `regimeForRate` classifies a _taxed_ line
as standard/reduced/zero. **The reverse-charge decision does NOT come from the
rate:** a §92e line keeps its 21/12 `ratePct` but takes its VAT **regime** from the
quote's frozen `mode` (`reverse_charge_92e` → the kernel's `"reverse_charge"`
regime, which zeroes the line VAT and drives the mandatory legend) — using
`regimeForRate` for this would wrongly classify the line `standard` and put a VAT
line on a reverse-charge document. The advance-
payment chain (§28 zálohová → tax document on the advance → final settlement with
`clearAdvancesByRate` offset → §42/45 correction) is modeled as **additional
`DocumentType`s the kernel already enumerates**, sequenced in O2-c/CAR-192 — the
schema and mapper are shaped to carry them from the start (no second freeze path).

### 5. Payment posture (ADR-O3, to the seam)

No payment gateway, no PSP, no reconciliation feed in v1 (the Cardo plane owns
_platform_ billing; what the fabricator invoices _their_ customers is product-
billing and must never conflate). Cash arrives at the bank; an admin marks the
invoice paid. Concretely: (a) **`variable_symbol`** derived from the document
number via the kernel's `variableSymbolFromNumber` (digits-only, ≤10, unique per
org+year by construction); (b) **IBAN** becomes a validated CZ legal-profile field
(`legal_profile.iban`) and invoice issue **fails closed 422 `iban_required`**
without it — no computed conversion from the free-text `bankAccount` (a silently
mis-derived payment target is the worst failure available here); (c) **`mark-paid`
/ `unmark-paid`** are admin-only, audited, idempotent (409 on repeat), and payment
status is _row state, never document content_ (mutating the frozen snapshot is
forbidden by construction); (d) the **SPAYD/QR payload is kernel-owned**
(`buildSpayd`, in flight) — the QR is part of the frozen `InvoiceFacts.payment` so
a reprinted invoice is byte-identical forever, and rasterization stays app-land at
the print surface (ADR 0087, zero PDF dep).

### 6. Reproducibility harness

`verifyInvoiceReproducibility` reloads the referenced immutable quote row +
`invoice.facts`, re-runs the mapper + the kernel build, and deep-equals against
`invoice.snapshot` — byte-identical or it names the diverging key. This is the I3
trust feature extended to the money document with **zero engine involvement** (the
quote already proves the engine half). The invoice itest asserts BOTH: the quote
still reproduces its golden (`129891.504`) AND the invoice reproduces itself.

### 7. Issue guards + state machine

`INVOICE_STATUSES = ["issued","paid"]`, both stored. Issue runs in one
`@Transactional()` mirroring quote issue: guards (order exists + not cancelled;
`invoice_order_active_uq` partial-unique makes double-click structural → 409;
legal profile complete incl. IBAN; live customer not GDPR-anonymized) → capture
`InvoiceFacts` → map + `render` → allocate the `"invoice"` series number INSIDE
the tx (gap-free, rolls back with the insert) → insert → audit → `invoice.issued`
outbox event (IDs-only, ADR 0037; `invoice.paid` on mark-paid). Replacement, not
correction: a wrong invoice is superseded (`superseded_by_id` chain, audited,
series intact); v1 does not generate opravné daňové doklady in-system (CAR-27 pass
2 must return the correction rule before FIL cutover — the run-alongside-Excel
period, CAR-30, is the deliberate safety net).

### 8. Conformance-gate seating

Perimetra's CI runs `runTaxCzConformance(impl)` from `@cardo/tax-cz/conformance`
(the ADR-0009 behavioral drift gate) at the seam, so a kernel version bump that
would silently change §92e/ISDOC output fails Perimetra's OWN gate before adoption
— the same drift-proof Mercata uses through its cutover.

### 9. The STOP boundary (what this ADR does NOT ship, and why)

`buildInvoice`, `buildSpayd`, and every ISDOC/Pohoda/UBL serialization are
**kernel-owned and out of scope** — Perimetra maps to `ExportableDocument`/
`ExportableIssuer` and calls `exporter.render(doc, issuer)`; it never re-derives
CZ tax logic. Concretely, **no invoice code ships with this ADR**; the build is
sliced by blocker:

- **O2-a (numbering consolidation)** — unblocked by the kernel, but its backfill
  migrates the **shipped legal quote-numbering series** and cannot be integration-
  tested without Docker (down on the authoring box 2026-07-15). It lands with the
  Testcontainers migration itest (backfill correctness + quote numbers byte-
  identical + gap-free allocation) — **blocker: Docker up.**
- **O2-b (invoice module + the consumer mapper + `Exportable*` mirror + FSM +
  guards + mark-paid + verify harness)** — **blocker: `@cardo/tax-cz` published /
  installable** (today unpublished, and `buildInvoice`/`buildSpayd`/the frozen
  `ExportableDocument` shape are in flight this cycle). Building the mapper against
  an unpublished, moving type only buys drift; the module scaffolds via
  `pnpm gen module` and adapts to this spec the moment the package installs.
- **O2-c (print surface + the §28 advance chain + §92e legend UI)** — depends on
  O2-b; the print route is the ADR-0087 `window.print()` pattern over the kernel's
  PDF view-model.

## Consequences

- **Blunt:** v1 has no in-system legal correction instrument — an erroneous issued
  invoice legally requires a manual opravný doklad outside the system until v1.1;
  CAR-27 pass 2 MUST return the correction rule before FIL cutover.
- The invoice-issue moment gains three hard 422s (legal profile incomplete / IBAN
  missing / customer anonymized) — friction that is correctness.
- The facts+snapshot pattern means an accountant-driven constant change (legend,
  rounding, rate) never retro-alters issued invoices — new documents follow the
  new rule, frozen ones stand (the ADR 0081 golden-re-baseline discipline).
- One allocator and one continuity story for the accountant after O2-a; the legacy
  `quote_number_sequence` lingers (harmless) until its contract-drop.
- The kernel dependency is a duplicated-mirror-until-publish cost (the `Exportable*`
  mirror + the conformance gate), accepted deliberately over re-deriving a
  regulated tax path — the worst outcome the kernel exists to prevent.

## Alternatives rejected

- **Re-derive CZ tax in Perimetra** (a second `deriveTaxBreakdown`/ISDOC path) —
  the exact duplication Martin vetoed 2026-07-14; two diverging §92e/ISDOC code
  paths is the worst outcome on a regulated path.
- **Build the invoice module now against a local `Exportable*` mirror** — mirrors
  an unpublished, in-flight kernel type (`buildInvoice`/`buildSpayd` don't exist
  yet) → guaranteed drift + rework; deferred to O2-b behind the publish blocker.
- **Ship O2-a's legal-numbering migration without the Docker itest** — an untested
  data migration on a legal document series is an irreversible-risk class; deferred
  behind the Docker blocker rather than pushed through autonomously.
- **Recompute invoice tax from live price tables** — retro-mutation risk, the exact
  bug class ADR 0080/0081 exist to kill; the mapper reuses the quote's frozen
  `TaxBreakdown`.
- **A second parallel counter table per class** — two allocator code paths to keep
  honest forever; O2-a consolidates while the row count is tiny.
- **Store payment status inside the frozen snapshot** — mutation of a frozen
  document, forbidden by construction; payment is row state.

```

```
