import type { MoneyTotals } from "@repo/engine";

/**
 * The real commercial margin (ADR 0059) as a PERCENT, 0–100.
 *
 * Deliberately a mirror of the server's `apps/api/src/modules/quotes/margin.ts`,
 * not a shared import: `apps/api` is a separate deployable and `@repo/engine` is
 * the pure interpreter, so neither is a home for a commercial display rule. The
 * two copies must agree because the configurator shows a rep the margin the
 * server will judge at `issue` — a divergence here is a rep who is told the
 * configuration clears the floor and then gets a 422. Kept in lockstep by hand,
 * the same precedent as the `OrgRole` tuple and `org-access.ts`↔`permissions.ts`
 * (ADR 0057).
 *
 * The degenerate branch matches the server exactly: a zero/negative price with a
 * real cost is unboundedly bad (−Infinity, which fails every floor), and a
 * zero price with zero cost is treated as 100 % rather than 0/0.
 */
export function marginPct(money: MoneyTotals, costMoney: MoneyTotals): number {
  const price = Number(money.total);
  const cost = Number(costMoney.total);
  if (price <= 0) return cost > 0 ? -Infinity : 100;
  return ((price - cost) / price) * 100;
}
