/**
 * The margin-floor guard's margin model (ADR 0056). The engine has no cost
 * basis yet — the price table carries SELL prices only (components/manufacturing/
 * installation), no cost columns — so a true `(price − cost)/price` margin is not
 * computable today. As an honest, byte-stable PROXY we treat the fabricator's
 * value-add (manufacturing + installation) over revenue as the margin: bought
 * material/accessory is the cost-like pass-through, labour is the margin lever.
 *
 * This is deliberately isolated so the cost-model slice can swap it for a real
 * margin without touching the guard/override/audit machinery. It reads
 * `result.totals` (the raw engine floats), never the I10 money strings — a
 * ratio, not a boundary amount, so it stays out of the money seam.
 */
import { type CategoryTotals } from "@repo/engine";

/** Injection token for the org margin floor (percent) — env-backed, see env.ts. */
export const QUOTE_MARGIN_FLOOR_PCT = Symbol("QUOTE_MARGIN_FLOOR_PCT");

/**
 * Margin percent = value-add share of revenue. Returns 100 for a zero/negative
 * total (no revenue to erode — never blocks a free/empty quote on a div-by-zero).
 */
export function quoteMarginPct(totals: CategoryTotals): number {
  if (totals.total <= 0) return 100;
  return ((totals.manufacturing + totals.installation) / totals.total) * 100;
}
