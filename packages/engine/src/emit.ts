/**
 * Output emission (CORE_SPEC §5) — prices the assembly graph's parts and rolls
 * them up by category. In slice 1 the BOM IS the parts list (each part rule
 * emits one rolled-up line, as in the MVP). The cut list / 3D / 2D emitters are
 * later steps and consume the same parts (I4).
 */
import { toMoneyString } from "@repo/model";

import type { CategoryTotals, CostTable, MoneyTotals, Part, PriceTable } from "./types.js";

/** Raised when a part has no resolvable price or cost — never default to 0 (I5). */
export class PriceError extends Error {
  constructor(message: string) {
    super(`${message} (I5: no silent zeros)`);
    this.name = "PriceError";
  }
}

/**
 * Resolve each part's price. A part with an explicit `totalPrice` (a fixed or
 * threshold price the recipe computed) keeps it; otherwise the unit price comes
 * from the part's own `pricePerUnit` (rate-based lines) or the price layer
 * keyed by component code, and the total is `quantity × unit price`.
 */
export function priceParts(parts: Part[], prices: PriceTable): Part[] {
  return parts.map((part) => {
    if (part.totalPrice !== undefined) return part;

    const unitPrice = part.pricePerUnit ?? prices.components[part.componentCode];
    if (unitPrice === undefined) {
      throw new PriceError(`No price for component "${part.componentCode}"`);
    }

    return {
      ...part,
      pricePerUnit: unitPrice,
      totalPrice: part.quantity * unitPrice,
    };
  });
}

/**
 * Resolve each part's cost-of-goods — the exact mirror of {@link priceParts}
 * against the cost layer (ADR 0059). A part with an explicit `totalCost` (the
 * recipe's labour expr already evaluated against cost numbers in `derive`) keeps
 * it; otherwise the unit cost comes from the part's own `costPerUnit` or the
 * cost layer keyed by component code, and the total is `quantity × unit cost`.
 */
export function costParts(parts: Part[], costs: CostTable): Part[] {
  return parts.map((part) => {
    if (part.totalCost !== undefined) return part;

    const unitCost = part.costPerUnit ?? costs.components[part.componentCode];
    if (unitCost === undefined) {
      throw new PriceError(`No cost for component "${part.componentCode}"`);
    }

    return {
      ...part,
      costPerUnit: unitCost,
      totalCost: part.quantity * unitCost,
    };
  });
}

/** The I10 boundary: totals leave the engine as decimal strings too. */
export function toMoneyTotals(totals: CategoryTotals): MoneyTotals {
  return {
    material: toMoneyString(totals.material),
    accessory: toMoneyString(totals.accessory),
    manufacturing: toMoneyString(totals.manufacturing),
    installation: toMoneyString(totals.installation),
    total: toMoneyString(totals.total),
  };
}

export function sumByCategory(parts: Part[]): CategoryTotals {
  const totals: CategoryTotals = {
    material: 0,
    accessory: 0,
    manufacturing: 0,
    installation: 0,
    total: 0,
  };
  for (const part of parts) {
    // Summing an unpriced part would be a silent zero — only priced parts
    // (post-priceParts) may be aggregated (I5).
    if (part.totalPrice === undefined) {
      throw new PriceError(`Unpriced part "${part.path}" in aggregation`);
    }
    totals[part.category] += part.totalPrice;
    totals.total += part.totalPrice;
  }
  return totals;
}

/** Cost-of-goods rollup — the mirror of {@link sumByCategory} over `totalCost`
 *  (ADR 0059). Only costed parts (post-{@link costParts}) may be aggregated. */
export function sumCostByCategory(parts: Part[]): CategoryTotals {
  const totals: CategoryTotals = {
    material: 0,
    accessory: 0,
    manufacturing: 0,
    installation: 0,
    total: 0,
  };
  for (const part of parts) {
    if (part.totalCost === undefined) {
      throw new PriceError(`Uncosted part "${part.path}" in aggregation`);
    }
    totals[part.category] += part.totalCost;
    totals.total += part.totalCost;
  }
  return totals;
}
