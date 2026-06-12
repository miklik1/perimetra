/**
 * Output emission (CORE_SPEC §5) — prices the assembly graph's parts and rolls
 * them up by category. In slice 1 the BOM IS the parts list (each part rule
 * emits one rolled-up line, as in the MVP). The cut list / 3D / 2D emitters are
 * later steps and consume the same parts (I4).
 */
import type { CategoryTotals, Part, PriceTable } from "./types";

/** Raised when a part has no resolvable price — never default to 0 (I5). */
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
