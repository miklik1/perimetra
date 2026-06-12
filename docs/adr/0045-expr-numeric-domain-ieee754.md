# ADR 0045 — Expr DSL evaluates in the IEEE-754 numeric domain (I10 money hardens later)

**Status:** Accepted (2026-06-12). Implemented in `@repo/model` (slice 1).

## Context

The rebuild's founding slice (CORE_SPEC §10 step 1) builds `@repo/model` (the
Expr DSL + schema) and `@repo/engine`, and must reproduce the MVP's
Excel-anchored sliding-gate goldens **byte-identically** — that is the proof of
I1 (determinism) and I2 (delta-0). CORE_SPEC I10 separately states the eventual
invariant that **money is decimal-as-string, never floats**, and quantities are
rationals where division occurs.

Two facts collide for slice 1:

1. The sliding-gate dimension chain needs `sin` (`diagonal = round((postA−50) /
sin(angle))`). `sin(35°)` is irrational — it cannot be represented as an
   exact rational, so a pure-rational numeric domain is impossible without
   immediately rounding, which defeats the point.
2. The MVP goldens (e.g. Kalkulace U34 = `81 451.504`) were computed in IEEE-754
   doubles. Reproducing them to full precision requires the _same_ arithmetic
   (e.g. `5.332 × 192 = 1023.744` accumulated without per-line rounding).

CORE_SPEC §10 step 1's stated proof obligations are **I1 and I2** — not I10.
I10's commercial weight (margin floors, DPH/reverse-charge, rounding policy)
only materializes with the pricing/cascade layer (step 3).

## Decision

The Expr DSL evaluates over the **IEEE-754 double** domain (`Value = number |
string | boolean`). This is defensible against I1: IEEE-754 is fully
deterministic and portable, so equal `(ast, scope)` inputs give byte-identical
outputs on any conformant engine. The only transcendental primitive, `sinDeg`,
is `Math.sin((deg·π)/180)` — exactly the MVP's expression — so the goldens
reproduce to full precision (I2 holds, verified delta-0 in
`@repo/fixtures/sliding-gate.delta0.test.ts`).

**I10 is honored at the boundary, not yet in the arithmetic.** `@repo/model`
defines `Mm` and `MoneyString` seam types; slice 1 computes in the numeric
domain and would format money to `MoneyString` at the result edge. Exact-decimal
money arithmetic (and rational quantities) land **with the pricing/cascade
layer (step 3)**, where the commercial rules that make exactness matter actually
exist. Forcing exact-decimal now would either break delta-0 (per-line rounding
shifts the total) or require re-deriving Excel's float semantics in decimal —
wasted effort before the layer that needs it.

The Expr function set is a **closed whitelist** (`+ − * / %`, comparisons,
`&& || !`, `min max abs floor ceil round roundUp roundTo clamp if sinDeg`). A
model that needs more does not get an escape hatch; the engine grows a new
whitelisted function (CORE_SPEC §3). `sinDeg` is the first such growth, added
for the sliding-gate diagonal.

## Consequences

- Slice 1 proves I1/I2 with the real Excel data; the numeric domain is not a
  shortcut but the correct domain for a chain that contains trigonometry.
- I10 remains a live obligation. **Check (step 3):** when the pricing/cascade
  layer lands, introduce exact-decimal `Money` arithmetic and rational
  quantities, and re-assert the goldens survive the switch (the per-line vs
  end-rounding question must be settled against FIL's invoice rounding).
- No floats ever cross a persistence or wire boundary as "money" without going
  through the `MoneyString` formatter — enforce when the DB/app layers arrive.

## Sources

- CORE_SPEC §3 (Expr DSL, whitelist-growth rule), §10 step 1 (I1/I2 proof
  obligation), I1/I2/I10.
- MVP `packages/calc-engine` (`sliding-gate.ts`, `bom.ts`, `pricing.ts`) and its
  Excel-anchored fixture `planka-100-2d-3panel-2026.ts` (U34 = 81 451.504).
