# ADR 0081 — Exact-decimal money + commercial rounding policy (golden re-baseline)

**Status:** Accepted (2026-06-26 — Phase A, the legal-document spine; interlocked
with ADR 0080). **Implementation:** Implemented (model `money.ts` exact-decimal
arithmetic + `RoundingPolicy`; the engine money boundary rounds under the
threaded policy; goldens re-baselined). The **canonical golden values are signed
off (2026-06-28, Martin)**; the **rounding-policy parameters remain
accountant-gated** (the re-baseline is a real, signed-off change, not a
pretended-stable invariant).

## Context

`money.ts` was 15-significant-digit **float canonicalisation** (`Number(value
.toPrecision(15))`) — a noise-strip that yields the decimal the double intended
(81451.50399999999 → "81451.504"), NOT decimal arithmetic and NOT commercial
rounding. Its own header flagged ADR 0045's open check: commercial rounding
"lands as an explicit policy argument, not a hardcoded default." The goldens
therefore carried **sub-haléř values** (`.504`) — mathematically the exact float
sum, but **not valid CZK money** (you cannot invoice 0.4 haléř). The tax layer
(ADR 0080) needs an exact, rounded base to compute VAT correctly.

## Decision

- **The Expr/pricing domain stays IEEE-754 float (ADR 0045 untouched)** — the
  delta-0 contract. The change is at the **I10 money boundary only.**
- `money.ts` gains **exact-decimal arithmetic** (BigInt scaled integers, no float
  re-rounding): `roundMoney`, `addMoney`, `mulMoney`, `percentOf`, and a
  `RoundingPolicy {scale, mode, granularity}` with a PROVISIONAL
  `DEFAULT_ROUNDING_POLICY` (haléř / half-up / end-of-invoice). `toMoneyString`
  (the noise-strip) is unchanged and becomes the primitive `roundMoney` builds on.
- The **policy is threaded from the price table** (a new `rounding_policy` JSONB
  column, frozen at publish, stamped via the immutable price-table version → a
  re-derived quote rounds identically, I3) — NOT a hardcoded default. The engine's
  money boundary (`toMoneyTotals`, per-line `totalPriceMoney`) applies the
  policy's `scale`+`mode`; `granularity` (per-line vs end-of-invoice) governs the
  tax rate-base aggregation in the tax layer, not the engine's rollup.
- **Golden re-baseline.** Rounding the engine money to haléř legitimately moves
  the sub-haléř goldens. Verified empirically (the only sub-haléř line in the
  corpus is `rack_mount` = 1023.744, which feeds the accessory bucket):

  | golden                      | old (float canon.) | new (haléř) |
  | --------------------------- | ------------------ | ----------- |
  | single gate total           | `81451.504`        | `81451.5`   |
  | gate/site accessory bucket  | `31548.504`        | `31548.5`   |
  | site aggregate total        | `129891.504`       | `129891.5`  |
  | steel-frame total           | `73741.504`        | `73741.5`   |
  | site w/o fence joint total  | `130241.504`       | `130241.5`  |
  | per-line `rack_mount` money | `1023.744`         | `1023.74`   |

  **Unchanged** (already at or below haléř): cost `79039.86`, lamela `75174.2`,
  fence `24570`, and every other line. **NB:** the roadmap listed cost `79039.86`
  among the values that change — it does NOT (it was already at haléř). The ADR
  records the actual deltas, which is more honest than pretending all three move.

## Consequences

- The engine `money` / per-line `totalPriceMoney` are now valid CZK (≤ haléř); the
  raw float `totals`/`bom[].totalPrice` stay full precision for internal
  aggregation + the margin ratio. I3 re-derivation compares the rounded money
  strings (unchanged comparison path).
- Re-baselined assertions across `@repo/fixtures` (goldens + corpus), the api
  integration suite, and the web derive/configurator/panels tests. The cascade
  harness's raw-float `toBeCloseTo(golden, 6)` checks dropped to `, 2)` (the raw
  float now sits within a haléř of the rounded golden — same precedent the delta0
  harness already used).
- **SIGNED OFF (2026-06-28, Martin):** (a) the new canonical golden numbers above
  are the accepted baseline. The `.504 → .5` move is the unavoidable consequence of
  rounding the I10 money boundary to at least haléř (sub-haléř values were never
  invoiceable CZK), so the values are blessed independent of the finer policy
  questions below.
- **STILL accountant-gated (provisional):** (b) the default policy _parameters_
  (haléř / half-up / end-of-invoice). The accountant must confirm: haléř vs
  whole-CZK rounding (cash zaokrouhlení), half-up vs half-even, and per-line vs
  end-of-invoice for the VAT base. The policy is data on the price table, so a later
  change is a publish, not a code change — but it WOULD re-baseline the goldens again
  (tracked at that change, not a reopening of this sign-off).

Related: ADR 0045 (the Expr numeric domain — float, untouched), ADR 0080 (the tax
layer rounds VAT/gross under this policy), CORE_SPEC I10. Roadmap: [vault]
Decision — enterprise-readiness gap analysis & phased roadmap (Phase A, the I10
honest completion).
