# ADR 0080 — Structured §92e/DPH tax layer

**Status:** Accepted (2026-06-26 — Phase A, the legal-document spine). Supersedes
the vestigial `price_table.dphRate (string) + reverseCharge (boolean)` tax model.
**Implementation:** Implemented (model `tax.ts`; the quote freezes a structured
breakdown; verify re-derives it). The exact §92e legal conditions, the mandatory
legend wording, and the standard rate are **PROVISIONAL — accountant-gated**
(non-blocking; flagged for confirmation).

## Context

A CZ daňový doklad / nabídka is legally defective without a structurally-correct
DPH treatment. The pre-existing model was a `dphRate` numeric string +
`reverseCharge` boolean on the price table — and it was **vestigial: applied
NOWHERE**. A quote froze only its net total (`result.money.total`); there was no
tax line, no breakdown, no §92e document. (The seed even carried `dphRate: "0.21"`
— a fraction where the field is documented as a percent — a latent bug that never
surfaced precisely because nothing read it.)

Two facts make a CZ tax document correct, and both are **structure, not a rate**:

1. **A per-rate breakdown** — net base per VAT rate → VAT amount per rate →
   gross. One rate is the common case; mixed-rate must be a data change, not a
   code change.
2. **§92e reverse charge is a DIFFERENT DOCUMENT, not a 0 % rate.** When both
   parties are CZ VAT payers AND the supply is construction/assembly work, the
   supplier issues a document with **no VAT line** and a **mandatory legend**
   ("daň odvede zákazník"); the customer self-assesses. Modelling it as `rate = 0`
   produces a confidently-wrong document on the headline differentiator — the
   roadmap's named risk.

## Decision

- A pure, deterministic tax layer in **`@repo/model`** (`tax.ts`): a discriminated
  `TaxModeKind = "standard_vat" | "reverse_charge_92e"`, a `resolveTaxMode(conditions)`
  encoding the §92e ruleset, and `deriveTaxBreakdown(rateBases, mode, policy,
currency)` → a `TaxBreakdown` (per-rate `{ratePct, netBase, vatAmount, gross}`
  lines sorted descending + net/VAT/gross totals + the rounding policy + the §92e
  legend). The engine stays **tax-free** (the established discipline: commercial
  rules are applied app-side, never inside the deterministic engine) — tax is
  computed over the engine's net output, but purely, so it re-derives.
- **§92e is per-TRANSACTION**, so the price-table `reverseCharge` boolean is
  **removed**. The mode is decided at issue from `resolveTaxMode({supplierVatPayer,
customerVatPayer, constructionAssembly})`. The supplier (a fabricator issuing DPH
  quotes) is a VAT payer; the buyer's status + the construction/assembly scope come
  from the issue request now, auto-filled from the attached customer once that
  entity lands (ADR 0082). `dphRate` stays on the price table as the standard rate.
- **The structured breakdown is FROZEN in the immutable quote snapshot** and
  re-derived at `verify`: the net rate-base comes from the frozen I10 money
  strings, the rate + rounding policy from the stamped (immutable) price table,
  and the mode from the frozen breakdown (a decision, not derivable from stamps).
  The breakdown is therefore part of I3 — a re-derived quote reproduces its tax
  document byte-identically. `verifyReproducibility` now compares `tax` too.
- **CZ-tax golden corpus** in `@repo/fixtures` (standard 21 %, §92e reverse-charge,
  mixed-rate, VAT rounding edges) tied to the REAL derived site net, plus
  integration coverage (issue → §92e issue → verify reproduces the breakdown).

## Consequences

- The price table gains nothing for tax beyond `dphRate`; the §92e/standard call
  is at issue. Workshop price-blindness still holds (the blind snapshot is a
  whitelist — `tax` is simply not copied through).
- Single rate is wired today (the price table's one `dphRate`); the breakdown
  shape carries many rates, so mixed-rate (per-component VAT classification) is a
  later data/authoring change, not an engine change.
- **Accountant-gated (non-blocking) — flagged for confirmation:** the exact §92e
  conditions (`resolveTaxMode` — CZ-CPA 41–43 scope + any thresholds), the
  mandatory legend wording (`REVERSE_CHARGE_92E_LEGEND_CS`), and continuous-vs-
  per-year numbering interplay (ADR 0079). The STRUCTURE is correct; the CONSTANTS
  are provisional and isolated to named constants for a one-line confirmation.

Related: ADR 0081 (exact-decimal money + rounding policy — interlocked; the tax
layer rounds VAT/gross under that policy), ADR 0079 (the document number),
ADR 0082 (the customer entity feeds the buyer VAT status), CORE_SPEC I3/I10.
Roadmap: [vault] Decision — enterprise-readiness gap analysis & phased roadmap
(Phase A, the §92e honesty correction).
