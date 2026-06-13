/**
 * Price-table contracts (CORE_SPEC §6) — the per-tenant versioned price store's
 * api↔frontend seam. The `table` payload mirrors the engine `PriceTable` (a
 * small, stable shape — worth a real zod schema, unlike the model contract).
 * Rates (margin floor, DPH) cross as decimal strings; the engine never sees
 * them (app-layer commercial guardrails).
 */
import { z } from "zod";

import { cursorQuerySchema, paginated } from "./api/pagination";

export const PRICE_TABLE_CURRENCIES = ["CZK", "EUR"] as const;
export const priceTableCurrencySchema = z.enum(PRICE_TABLE_CURRENCIES);
export type PriceTableCurrency = z.infer<typeof priceTableCurrencySchema>;

/** The engine price layer (mirrors @repo/engine `PriceTable`) — the JSONB body
 *  the engine consumes as a pure data argument. */
export const priceTableDataSchema = z.object({
  version: z.number().int(),
  components: z.record(z.string(), z.number()),
  manufacturing: z.object({ rate: z.number(), multiplier: z.number() }),
  installation: z.number(),
});
export type PriceTableData = z.infer<typeof priceTableDataSchema>;

/** List item — metadata only (the price body is fetched via GET/resolve). */
export const priceTableSummarySchema = z.object({
  id: z.uuid(),
  version: z.number().int(),
  currency: priceTableCurrencySchema,
  effectiveFrom: z.iso.datetime(),
  effectiveTo: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type PriceTableSummary = z.infer<typeof priceTableSummarySchema>;

/** Detail — the commercial guardrails + the engine price body. */
export const priceTableSchema = priceTableSummarySchema.extend({
  marginFloorPct: z.string().nullable(),
  dphRate: z.string(),
  reverseCharge: z.boolean(),
  table: priceTableDataSchema,
});
export type PriceTableDetail = z.infer<typeof priceTableSchema>;

export const publishPriceTableSchema = z.object({
  currency: priceTableCurrencySchema,
  effectiveFrom: z.iso.datetime(),
  effectiveTo: z.iso.datetime().nullable().optional(),
  marginFloorPct: z.string().optional(),
  dphRate: z.string(),
  reverseCharge: z.boolean().optional(),
  table: priceTableDataSchema,
});
export type PublishPriceTableInput = z.infer<typeof publishPriceTableSchema>;

export const listPriceTablesQuerySchema = cursorQuerySchema;
export type ListPriceTablesQuery = z.infer<typeof listPriceTablesQuerySchema>;

/** resolveActive: the table whose window covers `asOf` (defaults to now server-side). */
export const activePriceTableQuerySchema = z.object({
  asOf: z.iso.datetime().optional(),
});
export type ActivePriceTableQuery = z.infer<typeof activePriceTableQuerySchema>;

export const priceTablesPageSchema = paginated(priceTableSummarySchema);
export type PriceTablesPage = z.infer<typeof priceTablesPageSchema>;
