/**
 * Quote contracts (CORE_SPEC §6) — the quote lifecycle's api↔frontend seam.
 * The issue input carries the site graph + the per-instance roster (release pin
 * + raw config + overrides); the engine is the validation gate (invalid config
 * → typed issues, I5), so site/overrides cross as opaque payloads here.
 *
 * `stamps` is the engine `SiteStamps` (full I3 addressing); `snapshot` is the
 * frozen engine/renderer output — opaque to zod (it is the engine's own valid
 * output, not a leak vector).
 */
import { z } from "zod";

import { cursorQuerySchema, paginated } from "./api/pagination";
import { isoDatetime } from "./primitives";

export const QUOTE_STATUSES = ["draft", "issued", "accepted", "expired"] as const;
export const quoteStatusSchema = z.enum(QUOTE_STATUSES);
export type QuoteStatus = z.infer<typeof quoteStatusSchema>;

/** One configured instance in an issue request. */
export const quoteInstanceInputSchema = z.object({
  instanceId: z.string().min(1),
  /** "modelId@version" — resolved against the immutable release store. */
  releaseId: z.string().min(1),
  /** ConfigInput (raw per-instance values). */
  input: z.record(z.string(), z.unknown()),
  /** CascadeLayers (tenant/customer/quote overrides) — opaque to the wire. */
  overrides: z.unknown().optional(),
});
export type QuoteInstanceInput = z.infer<typeof quoteInstanceInputSchema>;

export const issueQuoteSchema = z.object({
  /** Nullable until project persistence lands. */
  projectId: z.uuid().optional(),
  /** The Site graph (terrain/placements/connections) — engine-validated. */
  site: z.unknown(),
  instances: z.array(quoteInstanceInputSchema).min(1),
  validUntil: isoDatetime.optional(),
  /** Cut-list blade kerf, mm — stamped into the snapshot (reproducibility). */
  kerfMm: z.number().int().nonnegative().optional(),
  /**
   * Admin-only escape hatch for the margin-floor guard (ADR 0056): when the
   * derived margin is below the org floor, an `admin` may issue anyway by
   * supplying a justification (audited as `quote.margin_override`). Ignored for
   * non-admin roles — sales gets a 422 they cannot override.
   */
  marginOverride: z.object({ reason: z.string().min(1) }).optional(),
});
export type IssueQuoteInput = z.infer<typeof issueQuoteSchema>;

/** Engine `SiteStamps` — the exact versioned inputs a quote re-derives from (I3). */
export const quoteStampsSchema = z.object({
  releaseIds: z.record(z.string(), z.string()),
  catalogVersion: z.number().int(),
  priceTableVersion: z.number().int(),
  overrideIds: z.array(z.string()),
});
export type QuoteStamps = z.infer<typeof quoteStampsSchema>;

export const quoteSummarySchema = z.object({
  id: z.uuid(),
  projectId: z.uuid().nullable(),
  status: quoteStatusSchema,
  currency: z.string(),
  /**
   * Decimal-string total (I10), or `null` for the PRICE-BLIND `workshop` view
   * (ADR 0056) — the server strips it, the field is never just FE-hidden.
   */
  total: z.string().nullable(),
  validUntil: isoDatetime.nullable(),
  shareToken: z.string(),
  createdAt: isoDatetime,
  updatedAt: isoDatetime,
});
export type QuoteSummary = z.infer<typeof quoteSummarySchema>;

export const quoteSchema = quoteSummarySchema.extend({
  stamps: quoteStampsSchema,
  /** Frozen outputs: bom / totals / money / cutList / drawings / inputs / site. */
  snapshot: z.unknown(),
});
export type QuoteDetail = z.infer<typeof quoteSchema>;

export const listQuotesQuerySchema = cursorQuerySchema.extend({
  status: quoteStatusSchema.optional(),
});
export type ListQuotesQuery = z.infer<typeof listQuotesQuerySchema>;

export const quotesPageSchema = paginated(quoteSummarySchema);
export type QuotesPage = z.infer<typeof quotesPageSchema>;

/** Result of the I3 reproducibility check (the verification path). */
export const quoteReproductionSchema = z.object({
  quoteId: z.uuid(),
  reproduced: z.boolean(),
  /** Artifacts (or missing stamps) that diverged — empty when reproduced. */
  mismatches: z.array(z.string()),
});
export type QuoteReproduction = z.infer<typeof quoteReproductionSchema>;
