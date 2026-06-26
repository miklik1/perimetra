/**
 * Price-table contracts (CORE_SPEC §6) — the per-tenant versioned price store's
 * api↔frontend seam. The `table` payload mirrors the engine `PriceTable` (a
 * small, stable shape — worth a real zod schema, unlike the model contract).
 * Rates (margin floor, DPH) cross as decimal strings; the engine never sees
 * them (app-layer commercial guardrails).
 */
import { z } from "zod";

import { cursorQuerySchema, paginated } from "./api/pagination";
import { isoDatetime } from "./primitives";

export const PRICE_TABLE_CURRENCIES = ["CZK", "EUR"] as const;
export const priceTableCurrencySchema = z.enum(PRICE_TABLE_CURRENCIES);
export type PriceTableCurrency = z.infer<typeof priceTableCurrencySchema>;

/** A non-negative decimal as a string (rates, percents) — matches the drizzle
 *  `numeric` representation so a bad value is a 422, not a DB 500. */
const decimalString = z.string().regex(/^\d+(\.\d+)?$/, "must be a decimal string");

/** Commercial rounding policy (ADR 0081) — mirrors @repo/model `RoundingPolicy`
 *  structurally (validators carries no engine dep). The money + tax boundary
 *  rounds to `scale` places under `mode`; `granularity` governs the tax rate-base
 *  aggregation. Stamped via the price-table version → a re-derived quote rounds
 *  identically (I3). */
export const roundingPolicySchema = z.object({
  scale: z.number().int().min(0).max(4),
  mode: z.enum(["half-up", "half-even"]),
  granularity: z.enum(["per-line", "end-of-invoice"]),
});
export type RoundingPolicyContract = z.infer<typeof roundingPolicySchema>;

/** The engine price layer (mirrors @repo/engine `PriceTable`) — the JSONB body
 *  the engine consumes as a pure data argument. */
/** Values are non-negative numbers — negative price/cost is nonsense money; zero
 *  is legitimate (a free or no-cost-of-goods line). A MISSING component is the
 *  I5 case the engine throws on, not validated away here. */
const layerValue = z.number().nonnegative();
const priceLayerShape = {
  components: z.record(z.string(), layerValue),
  manufacturing: z.object({ rate: layerValue, multiplier: layerValue }),
  installation: layerValue,
};

export const priceTableDataSchema = z.object({
  version: z.number().int(),
  ...priceLayerShape,
});
export type PriceTableData = z.infer<typeof priceTableDataSchema>;

/** The engine cost layer (mirrors @repo/engine `CostTable`) — same shape as the
 *  price body minus `version` (cost shares the price table's version, ADR 0059). */
export const costTableDataSchema = z.object(priceLayerShape);
export type CostTableData = z.infer<typeof costTableDataSchema>;

/** List item — metadata only (the price body is fetched via GET/resolve). */
export const priceTableSummarySchema = z.object({
  id: z.uuid(),
  version: z.number().int(),
  currency: priceTableCurrencySchema,
  effectiveFrom: isoDatetime,
  effectiveTo: isoDatetime.nullable(),
  createdAt: isoDatetime,
  updatedAt: isoDatetime,
});
export type PriceTableSummary = z.infer<typeof priceTableSummarySchema>;

/** Detail — the commercial guardrails + the engine price body (+ cost body). */
export const priceTableSchema = priceTableSummarySchema.extend({
  marginFloorPct: z.string().nullable(),
  dphRate: z.string(),
  /** Resolved commercial rounding policy (never null on the wire — defaulted
   *  server-side, ADR 0081). */
  roundingPolicy: roundingPolicySchema,
  table: priceTableDataSchema,
  cost: costTableDataSchema.nullable(),
});
export type PriceTableDetail = z.infer<typeof priceTableSchema>;

export const publishPriceTableSchema = z.object({
  currency: priceTableCurrencySchema,
  effectiveFrom: isoDatetime,
  effectiveTo: isoDatetime.nullable().optional(),
  marginFloorPct: decimalString.optional(),
  dphRate: decimalString,
  /** Optional — defaults to the provisional policy server-side (ADR 0081). */
  roundingPolicy: roundingPolicySchema.optional(),
  table: priceTableDataSchema,
  cost: costTableDataSchema.optional(),
});
export type PublishPriceTableInput = z.infer<typeof publishPriceTableSchema>;

export const listPriceTablesQuerySchema = cursorQuerySchema;
export type ListPriceTablesQuery = z.infer<typeof listPriceTablesQuerySchema>;

/** resolveActive: the table whose window covers `asOf` (defaults to now server-side). */
export const activePriceTableQuerySchema = z.object({
  asOf: isoDatetime.optional(),
});
export type ActivePriceTableQuery = z.infer<typeof activePriceTableQuerySchema>;

export const priceTablesPageSchema = paginated(priceTableSummarySchema);
export type PriceTablesPage = z.infer<typeof priceTablesPageSchema>;
