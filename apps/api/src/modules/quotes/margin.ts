/**
 * The margin-floor guard's margin model (ADR 0056 → ADR 0059). Now a REAL gross
 * margin: `(price − cost) / price`, off the engine's derived sell totals and the
 * cost-of-goods totals the cost layer produces. This retires the value-add proxy
 * (manufacturing+installation over revenue) the engine used before a cost basis
 * existed, AND the env-backed org-wide floor — the floor is now per-org, read
 * from the active price table's `marginFloorPct` (see quotes.service).
 *
 * It reads `result.totals` / `result.costTotals` (the raw engine floats), never
 * the I10 money strings — a ratio, not a boundary amount, so it stays out of the
 * money seam.
 */
import { type CategoryTotals } from "@repo/engine";

/**
 * Gross margin percent = (revenue − cost) / revenue × 100. A loss-making quote
 * (cost > revenue) returns a negative percent so the floor guard catches it.
 * Zero/negative revenue can't divide: a truly free quote (no cost either) is
 * 100 % and never blocked, but zero revenue with real cost is a total loss →
 * −Infinity so any non-negative floor rejects it (never a silent pass).
 */
export function quoteMarginPct(totals: CategoryTotals, costTotals: CategoryTotals): number {
  if (totals.total <= 0) return costTotals.total > 0 ? -Infinity : 100;
  return ((totals.total - costTotals.total) / totals.total) * 100;
}
