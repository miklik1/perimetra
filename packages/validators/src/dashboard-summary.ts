/**
 * `GET /v1/me/dashboard-summary` (ADR 0125) — the aggregate the owner "Přehled"
 * dashboard (`app/page.tsx`, the bare `/` route) reads on load. Like
 * `nav-counts` (its sibling in the nav module), this is a pure read aggregate
 * over the quotes + orders services — no PII, no entity bodies — so it is cheap
 * to poll and safe to invalidate off the `org:<id>` realtime channel.
 *
 * CONTRACT-HONESTY (Phase 2, Wave D): the dashboard is an honest SUBTRACTION of
 * the design canvas — it carries ONLY fields a real backend source backs. There
 * is deliberately NO leads/Poptávky field (no leads module — `nav-counts` never
 * emits it either), NO revenue/Vyfakturováno/Tržby/money-total field (invoices
 * are not adoption-wired; revenue is never fabricated), NO deposit ("Čeká na
 * doplatek"), and NO scheduling/Nadcházející field (no scheduling concept).
 *
 * ROLE-FILTERED via OPTIONAL keys (the `nav-counts` convention): a key is
 * present only when the caller may see that surface, so an ABSENT key means "not
 * shown", never a zero/empty placeholder. The price-blind `workshop` role
 * (`isPriceBlind`, ADR 0056) gets the deliberately-sparse subset — the
 * `activeOrders` KPI + orders-only `activity`, and NOTHING else: no quotes KPI,
 * no funnel, no expiring-quotes widget, and no money anywhere. admin/sales get
 * the full shape; a `sales` caller's quote-derived numbers are owner-narrowed
 * server-side (ADR 0082).
 */
import { z } from "zod";

import { orderStatusSchema } from "./orders";
import { isoDatetime } from "./primitives";
import { quoteStatusSchema } from "./quotes";

/**
 * KPI tiles — non-negative integer COUNTS (never money). `activeOrders` (the
 * live build queue: `confirmed` + `in_production`) is ALWAYS present — it is the
 * one KPI every role, workshop included, may see. The rest are quotes-derived
 * and therefore non-workshop only (absent for the price-blind role).
 */
export const dashboardKpisSchema = z.object({
  /** Active orders — `confirmed` + `in_production`. Always present. */
  activeOrders: z.number().int().nonnegative(),
  /** Open quotes needing attention — `draft` + `issued` (owner-narrowed for
   *  sales). Non-workshop only. */
  openQuotes: z.number().int().nonnegative().optional(),
  /** Accepted quotes (owner-narrowed for sales). Non-workshop only. */
  acceptedQuotes: z.number().int().nonnegative().optional(),
  /** Issued quotes whose `validUntil` is within the near horizon. Non-workshop
   *  only. */
  expiringSoon: z.number().int().nonnegative().optional(),
});
export type DashboardKpis = z.infer<typeof dashboardKpisSchema>;

/**
 * The scoped 2-stage sales funnel (non-workshop) — honest 2-stage ONLY: open
 * quotes (`Nabídky`) → active orders (`Objednáno`). There is NO leads stage
 * (no leads module) and NO invoiced stage (no revenue source).
 */
export const dashboardFunnelSchema = z.object({
  quotes: z.number().int().nonnegative(),
  orders: z.number().int().nonnegative(),
});
export type DashboardFunnel = z.infer<typeof dashboardFunnelSchema>;

/**
 * One expiring-quotes widget row (non-workshop) — an issued quote sorted by
 * `validUntil` ascending. `total` is the decimal-string money (I10) or `null`
 * (never present for workshop — the whole section is dropped for that role).
 */
export const dashboardExpiringQuoteSchema = z.object({
  id: z.uuid(),
  number: z.string().nullable(),
  validUntil: isoDatetime.nullable(),
  status: quoteStatusSchema,
  total: z.string().nullable(),
});
export type DashboardExpiringQuote = z.infer<typeof dashboardExpiringQuoteSchema>;

/**
 * One merged activity row (always present, every role) — a recent order OR
 * quote by `updatedAt` descending. `kind` discriminates the source; `status` is
 * the matching order/quote status. This is built from the orders + quotes
 * `updatedAt` only — NOT the audit trail (the audit module's CONTEXT.md forbids
 * cross-module audit reads). Carries no money.
 */
export const dashboardActivityItemSchema = z.object({
  kind: z.enum(["order", "quote"]),
  id: z.uuid(),
  number: z.string().nullable(),
  status: z.union([orderStatusSchema, quoteStatusSchema]),
  updatedAt: isoDatetime,
});
export type DashboardActivityItem = z.infer<typeof dashboardActivityItemSchema>;

export const dashboardSummaryResponseSchema = z.object({
  kpis: dashboardKpisSchema,
  /** The 2-stage sales funnel — non-workshop only (absent for workshop). */
  funnel: dashboardFunnelSchema.optional(),
  /** Expiring issued quotes, `validUntil` ascending — non-workshop only. An
   *  empty array is a rendered "nothing soon" note; ABSENT means the section
   *  does not apply (workshop). */
  expiringQuotes: z.array(dashboardExpiringQuoteSchema).optional(),
  /** Merged recent orders + quotes, `updatedAt` descending. Always present
   *  (workshop gets orders-only rows). */
  activity: z.array(dashboardActivityItemSchema),
});
export type DashboardSummaryResponse = z.infer<typeof dashboardSummaryResponseSchema>;
