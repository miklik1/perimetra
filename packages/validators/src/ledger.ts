/**
 * Deviation-ledger contracts (ADR 0110 / ADR-O4, CAR-159) — the queryable
 * projection of every deviation (quote-scope override, margin override, order
 * exception) + the recurrence report that drives the vendor ETO→CTO promotion
 * queue. The ledger records and reports; the ENGINE enforces bounds.
 */
import { z } from "zod";

import { cursorQuerySchema } from "./api/pagination";
import { isoDatetime } from "./primitives";

// Kept in lockstep with `@repo/db/schema/ledger` DEVIATION_SOURCES.
export const DEVIATION_SOURCES = ["quote_override", "margin_override", "order_exception"] as const;
export const deviationSourceSchema = z.enum(DEVIATION_SOURCES);
export type DeviationSource = z.infer<typeof deviationSourceSchema>;

export const ledgerEntrySchema = z.object({
  id: z.uuid(),
  quoteId: z.uuid(),
  orderId: z.uuid().nullable(),
  source: deviationSourceSchema,
  kind: z.string().nullable(),
  target: z.string().nullable(),
  value: z.unknown().nullable(),
  reason: z.string(),
  actorId: z.string().nullable(),
  createdAt: isoDatetime,
});
export type LedgerEntry = z.infer<typeof ledgerEntrySchema>;

/** One `recurrenceReport` group (ADR 0048) — a recurring deviation the vendor
 *  may promote into a real option in the next release. */
export const recurrenceGroupSchema = z.object({
  target: z.string(),
  occurrences: z.number().int(),
  distinctQuotes: z.number().int(),
  values: z.array(z.unknown()),
  reasons: z.array(z.string()),
});
export type RecurrenceGroup = z.infer<typeof recurrenceGroupSchema>;

export const ledgerPageSchema = z.object({
  items: z.array(ledgerEntrySchema),
  nextCursor: z.string().nullable(),
  /** The recurrence report over the org's `quote_override` deviations (matching
   *  the `target` filter when given) — computed globally, not just this page. */
  recurrence: z.array(recurrenceGroupSchema),
});
export type LedgerPage = z.infer<typeof ledgerPageSchema>;

export const listLedgerQuerySchema = cursorQuerySchema.extend({
  target: z.string().optional(),
  from: isoDatetime.optional(),
  quoteId: z.uuid().optional(),
});
export type ListLedgerQuery = z.infer<typeof listLedgerQuerySchema>;

/** Record a production-time order exception (admin/workshop). */
export const orderExceptionSchema = z.object({
  reason: z.string().min(1).max(500),
  /** Optional deviation target (e.g. a substituted material) — free text. */
  target: z.string().max(200).optional(),
});
export type OrderExceptionInput = z.infer<typeof orderExceptionSchema>;

/** Result of the snapshot-driven `quote_override` re-projection (rebuild). */
export const ledgerRebuildResultSchema = z.object({
  projected: z.number().int(),
});
export type LedgerRebuildResult = z.infer<typeof ledgerRebuildResultSchema>;
