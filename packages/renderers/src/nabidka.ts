/**
 * Nabídka (commercial offer) emission — the L layer of the split PDF (ADR 0085).
 * PURE DATA off `(Site, SiteResult)` + the frozen §92e/DPH tax breakdown
 * (ADR 0080) + the buyer + the gap-free document number (ADR 0079). No I/O, no
 * layout: the thin PDF surface in app-land draws this shape, nothing more (I4).
 *
 * Everything here is already I10-canonical (money is the engine's decimal
 * strings; the tax breakdown is the frozen, re-derivable document) — so a
 * nabídka built off a re-derived quote is byte-identical to the one issued (I3).
 */
import type { SiteResult } from "@repo/engine";
import type { Site, TaxBreakdown } from "@repo/model";

/** Buyer identity frozen onto the document — a subset of the customer entity
 *  (ADR 0082); only the fields a daňový doklad carries. */
export interface NabidkaCustomer {
  name: string;
  ico?: string | null;
  dic?: string | null;
  addressLine?: string | null;
  city?: string | null;
  postalCode?: string | null;
}

/** One priced offer line (a rolled-up BOM line). */
export interface NabidkaLine {
  componentCode: string;
  name: string;
  unit: string;
  category: string;
  quantity: number;
  /** I10 decimal string (net, the line price). */
  totalPriceMoney: string;
}

/** A net subtotal per BOM category (material / accessory / manufacturing / installation). */
export interface NabidkaCategory {
  key: "material" | "accessory" | "manufacturing" | "installation";
  total: string;
}

/** The pure-data nabídka — header, line items, category subtotals, the tax
 *  document, and totals. The presentation surface lays this out. */
export interface NabidkaDocument {
  documentNumber: string;
  customer: NabidkaCustomer | null;
  currency: string;
  /** Number of configured assemblies on the site (placements). */
  instanceCount: number;
  lines: NabidkaLine[];
  categories: NabidkaCategory[];
  /** The structured §92e/DPH tax breakdown (per-rate net→VAT→gross + legend). */
  tax: TaxBreakdown;
  netTotal: string;
  vatTotal: string;
  grossTotal: string;
  /** Mandatory §92e legend ("daň odvede zákazník"); absent for standard VAT. */
  legend?: string;
}

export interface NabidkaOptions {
  documentNumber: string;
  tax: TaxBreakdown;
  customer?: NabidkaCustomer | null;
}

const CATEGORY_KEYS = ["material", "accessory", "manufacturing", "installation"] as const;

/**
 * Build the nabídka document. Pure + deterministic — a re-derived quote yields
 * the identical document (I3). The order-sensitive line list mirrors the engine's
 * BOM order (already canonical at issue time).
 */
export function buildNabidka(
  site: Site,
  result: SiteResult,
  options: NabidkaOptions,
): NabidkaDocument {
  const lines: NabidkaLine[] = result.bom.map((line) => ({
    componentCode: line.componentCode,
    name: line.name,
    unit: line.unit,
    category: line.category,
    quantity: line.quantity,
    totalPriceMoney: line.totalPriceMoney,
  }));

  const categories: NabidkaCategory[] = CATEGORY_KEYS.map((key) => ({
    key,
    total: result.money[key],
  }));

  return {
    documentNumber: options.documentNumber,
    customer: options.customer ?? null,
    currency: options.tax.currency,
    instanceCount: site.placements.length,
    lines,
    categories,
    tax: options.tax,
    netTotal: options.tax.netTotal,
    vatTotal: options.tax.vatTotal,
    grossTotal: options.tax.grossTotal,
    ...(options.tax.legend !== undefined ? { legend: options.tax.legend } : {}),
  };
}
