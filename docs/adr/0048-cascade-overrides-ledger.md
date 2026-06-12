# ADR 0048 — Cascade & override semantics: one write path, quote-only deviations, ledger as a query

**Status:** Accepted (2026-06-12). Implemented in step 3 (CORE_SPEC §10).

## Context

CORE_SPEC §4 specifies the five-layer resolution cascade (release → catalog →
tenant → customer → quote) and the Override record, §6 the artifact-level
patch, and I7/I8 the guard rails (tenants cannot break models; overrides
layer, never mutate). The spec leaves several semantics open that the
implementation must pin down: where direct config input sits relative to the
override layers, what `deviation` means operationally against `domain`, which
scopes may deviate at all, and what the I10 money boundary does while the
arithmetic stays IEEE-754 (ADR 0045).

## Decision

1. **One write path (I7).** Every parameter write — config input or override —
   passes the same gate machinery (`adjustability`, type, envelope). There is
   no privileged side door; the cascade module composes the same checks the
   input gate uses.

2. **Config input sits between customer and quote.** Tenant/customer `param:`
   overrides patch the parameter's **default** (user input wins over them) and
   must stay inside `domain` — a default is configuration, not a deviation.
   Quote `param:` overrides are **deviations**: they win over input, and the
   parameter's `deviation` spec replaces `domain` as the envelope. A parameter
   without a `deviation` spec does not bend beyond its domain at any scope —
   absent knowledge means no flex, never a guess (I5).

3. **Deviation semantics: bounds reject, warn requires reason, free is
   silent.** `bounds` (expressions, evaluated against the pre-deviation scope
   — a structural limit may depend on other parameters) are the absolute
   envelope at every mode; outside → error Issue. `mode: "warn"` additionally
   requires `reason` and stamps a warn Issue on the result (the workshop
   flag). `mode: "hard"` requires bounds at author time
   (`validateRelease` defect `deviation.unbounded`) — the bounds ARE the
   extracted knowledge. Cross-parameter constraints still evaluate after a
   deviation is applied: the deviation gate is per-parameter, engineering
   rules keep the last word.

4. **`price:` overrides at all three scopes, later wins.** Targets are
   price-table entries (component codes plus `manufacturing_rate` /
   `manufacturing_multiplier` / `installation`). A code the base table lacks
   is legal (tenants price new SKUs) but flagged with a warn Issue — a typo
   must never silently create a dead entry.

5. **`artifact:` overrides are quote-only** (CORE_SPEC §6) and applied to the
   priced parts. A `quantity` patch requires an explicit `pricingResolution`
   (`keep_price` pins the derived line total, `reprice` recomputes quantity ×
   unit); `pricePerUnit`/`totalPrice` patches ARE the pricing resolution;
   `lengthMm` is geometry-only. Every applied patch lands as a deviation flag
   on the part (`Part.deviations`) AND a warn Issue; a stale address (part no
   longer emitted) is an error, not a skip (I5/I9).

6. **The ledger is a pure query, not a store.** `exceptionLedger()` = the
   quote-scope override set; `recurrenceReport()` groups it by exact target
   and counts distinct quotes — the vendor's promotion queue (ETO→CTO).
   Promotion stays a human decision. "± similar value" clustering is a report
   refinement for later; it changes no schema.

7. **Stamps complete I3:** results carry `{releaseId, catalogVersion,
priceTableVersion, overrideIds[]}` — the exact cascade state, in
   application order. `PriceTable` gains `version` and stays a versioned data
   argument like the catalog (ADR 0046).

8. **I10 money boundary: decimal-as-string, canonicalized to 15 significant
   digits.** Totals leave the engine as `DerivationResult.money`
   (`MoneyString` per category). Implementing the string lock surfaced that
   the engine's float SUM drifts one ulp off the Excel anchors
   (81451.50399999999 vs 81451.504, masked until now by `toBeCloseTo`); the
   anchors themselves are Excel's 15-significant-digit renderings of the same
   float arithmetic, so the boundary canonicalizes with `toPrecision(15)` —
   noise erasure matching the goldens' provenance, NOT a commercial rounding
   policy. Delta-0 is now asserted **string-exact** on all three goldens.
   Invoice rounding (haléře vs whole-CZK, per-line vs end) remains a pending
   extraction item and will land as an explicit policy argument (ADR 0045's
   open check, narrowed to rounding only).

Deferred, by scope: option-availability targets ("disabled options",
CORE_SPEC §4 tenant layer) and margin-floor enforcement consume
`pricingResolution` at the app layer — neither changes the Override record.

## Consequences

- The FIL exception story is mechanical: out-of-catalog request → quote
  deviation with reason → flagged result → ledger row → recurrence report →
  vendor promotes in the next release. Each step is data; nothing is code.
- Removing any override re-derives the exact lower-layer result (proven in
  fixtures: delta-0 restored to the string) — clone-on-approve stays dead.
- Sales is never blocked and never silent: every accepted deviation is a warn
  Issue + provenance row; every rejected one is a typed, localizable Issue.
- The deviation envelope makes the value of FIL extraction concrete: until a
  parameter carries a `deviation` spec, it does not bend — the authored specs
  in `sliding-gate@1` are placeholders marked for extraction.
