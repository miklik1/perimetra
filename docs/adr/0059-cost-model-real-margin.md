# ADR 0059 — Cost model: real `(price − cost)/price` margin + per-org floor

**Status:** Accepted (2026-06-15). Implemented. Retires the value-add proxy and
the env-backed floor from [ADR 0056](0056-rbac-roles.md); rides the I3 stamp from
[ADR 0053](0053-quote-lifecycle.md) and the org scope from
[ADR 0055](0055-org-scope-activation.md).

## Context

ADR 0056 shipped a margin-floor guard but with two explicit placeholders, because
no cost basis existed:

- **Margin was a proxy** — `quoteMarginPct = (manufacturing + installation) /
total`, treating bought material as 100 % cost and all labour as margin. Every
  number in it was real _revenue_; none was real _cost_.
- **The floor was a single env constant** — `QUOTE_MARGIN_FLOOR_PCT` (default 0 =
  inert), org-wide, not per-tenant. The `price_table` row already carried a
  `marginFloorPct` numeric column, but the guard never read it (dead wire).

The price table carries **sell** prices only (`components` + `manufacturing`
rate/multiplier + `installation`). A real `(price − cost)/price` margin needs a
cost-of-goods basis, and that basis must satisfy the same invariants as price:
stamped and re-derivable (I3), no silent zero on a missing cost (I5), never
visible to the workshop role (ADR 0056 price-blind), and computed by the **pure**
engine, not ambiently (ADR 0046).

The decisive enabler: the release recipe is **value-source-agnostic**. Labour
parts read `price.manufacturing_rate` from the evaluation scope and carry the
derived hours as `quantity`; material parts read `components[code]`. So the same
recipe, evaluated against **cost** numbers, yields **cost** — no recipe / model-
contract change, and labour cost (wage × the real derived hours) is computable,
not just material cost.

## Decision

- **Cost is a pure engine layer, computed by re-evaluating the recipe against a
  cost table.** `deriveInstance`/`deriveSite` take an optional `costs?: CostTable`
  (`CostTable = PriceLayer` — same shape as `PriceTable` minus `version`). The
  engine builds a cost scope = the real scope with `price.*` swapped for cost
  numbers (derived dimensions stay physical, computed once), re-evaluates the
  part value exprs against it (`costParts`/`sumCostByCategory` mirror
  `priceParts`/`sumByCategory`), and emits `costTotals` + `costMoney` on the
  result. Absent `costs` → no cost output (optional fields, not zero). The
  configurator/site canvas pass no cost layer and are unaffected.

- **Cost co-locates on the `price_table` row** (a new nullable `cost` JSONB
  column), so the existing `priceTableVersion` stamp covers it — **no new stamp
  field, no separate cost version/table**. `verifyReproducibility` reloads the
  row by version, re-derives, and deep-equals the frozen `costMoney` (I3). A
  separate cost table (independent cost versioning) was rejected as speculative;
  it remains an additive escape hatch if ever needed.

- **Real margin, per-org floor.** `quoteMarginPct(totals, costTotals) =
(total − costTotal)/total × 100`. The floor is read from the active price
  table's `marginFloorPct` at issue (already resolved in scope); `null` = inert.
  `QUOTE_MARGIN_FLOOR_PCT` (env var + DI token + module provider) is **removed**.
  A floor set with no cost data is a surfaced misconfiguration
  (`margin_floor_without_cost`, 422), never a silent pass (I5).

- **Cost respects sharing and overrides like price.** Site cost rolls up over the
  same post-sharing parts, so shared elements (I6) are costed once. A quantity
  artifact override always scales `totalCost` (more units cost more — keep_price
  thus erodes margin and the guard sees it); a `price:` or price-artifact
  override never touches cost. The admin override audit records the **real**
  margin and per-org floor.

- **Workshop stays cost/margin-blind for free.** `blindSnapshot` is a whitelist;
  `costTotals`/`costMoney` are simply not copied through (the existing design's
  stated intent — a new price-bearing field can't leak by being forgotten).

## Consequences

- The margin guard now means something: a loss-making quote (cost > revenue)
  returns a negative percent and is blocked; the per-org floor is tenant data,
  set per published price-table version.
- I3 holds with zero new stamps — cost reproducibility is exercised in
  `quotes.itest` (frozen `costMoney.total = 79039.86`, re-derived byte-identical).
- The golden price total `129891.504` is unchanged — cost is a parallel additive
  pass that never enters the price derivation (engine + fixtures goldens lock
  both). Golden site margin ≈ 39.15 %.
- `manufacturing.multiplier` is unused on the cost side (labour hours are
  physical, fixed from the sell-side multiplier); mirrored only for shape.
- Cost authoring rides the existing publish contract (`cost` optional on
  `publishPriceTableSchema`); a publish **UI** is still the deferred admin-publish
  slice. The OpenAPI contract snapshot gains the `cost` body.
- Deferred: per-line cost on the BOM (`SiteBomLine.totalCostMoney`) — only needed
  for a margin-breakdown UI; aggregate cost suffices for the guard today.
