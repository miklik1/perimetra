/**
 * Quote contracts (CORE_SPEC §6) — the quote lifecycle's api↔frontend seam.
 * The issue input carries the site graph + the per-instance roster (release pin
 * + raw config + overrides); the engine is the validation gate (invalid config
 * → typed issues, I5), so site/overrides cross as opaque payloads here.
 *
 * `stamps` is the engine `SiteStamps` (full I3 addressing); `snapshot` is the
 * frozen engine/renderer output — opaque to zod (the engine's own valid output).
 * It ALSO carries the frozen buyer identity (ADR 0086): authorized-issuer data,
 * stripped server-side for the price-blind workshop, so passthrough is sound.
 */
import { z } from "zod";

import { cursorQuerySchema, paginated } from "./api/pagination";
import { isoDatetime } from "./primitives";

export const QUOTE_STATUSES = ["draft", "issued", "accepted", "declined", "expired"] as const;
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
  /** The attached buyer (odběratel, ADR 0082). When present, the §92e VAT-status
   *  is auto-filled from the customer (the request `tax.customerVatPayer` is
   *  ignored in favour of the customer's own flag). */
  customerId: z.uuid().optional(),
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
  /**
   * Tax facts for the §92e/DPH decision (ADR 0080). §92e reverse charge is a
   * per-TRANSACTION call: it applies only when the buyer is a CZ VAT payer AND
   * the supply is construction/assembly. Absent → standard VAT. The buyer's VAT
   * status is auto-filled from the attached customer once that entity lands
   * (ADR 0082); supplied explicitly here until then.
   */
  tax: z
    .object({
      customerVatPayer: z.boolean().optional(),
      constructionAssembly: z.boolean().optional(),
    })
    .optional(),
});
export type IssueQuoteInput = z.infer<typeof issueQuoteSchema>;

/** Engine `SiteStamps` — the exact versioned inputs a quote re-derives from (I3).
 *  `catalogVersions` is releaseId → catalog version (per-release catalog,
 *  ADR 0065): each release re-derives against its OWN pinned catalog. */
export const quoteStampsSchema = z.object({
  releaseIds: z.record(z.string(), z.string()),
  catalogVersions: z.record(z.string(), z.number().int()),
  priceTableVersion: z.number().int(),
  overrideIds: z.array(z.string()),
});
export type QuoteStamps = z.infer<typeof quoteStampsSchema>;

export const quoteSummarySchema = z.object({
  id: z.uuid(),
  projectId: z.uuid().nullable(),
  customerId: z.uuid().nullable(),
  status: quoteStatusSchema,
  /** Gap-free, org-scoped, per-year evidence number (ADR 0079), `{year}/{seq:04d}`. */
  documentNumber: z.string(),
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
  /** Frozen outputs: bom / totals / money / cutList / drawings / inputs / site /
   *  tax + the frozen buyer identity (ADR 0086). Opaque passthrough. */
  snapshot: z.unknown(),
});
export type QuoteDetail = z.infer<typeof quoteSchema>;

export const listQuotesQuerySchema = cursorQuerySchema.extend({
  status: quoteStatusSchema.optional(),
});
export type ListQuotesQuery = z.infer<typeof listQuotesQuerySchema>;

export const quotesPageSchema = paginated(quoteSummarySchema);
export type QuotesPage = z.infer<typeof quotesPageSchema>;

/** Buyer-facing acknowledgement of an accept/decline via shareToken (ADR 0083) —
 *  deliberately minimal (the document number + the new status), never the priced
 *  snapshot. */
export const quoteAcceptanceSchema = z.object({
  documentNumber: z.string(),
  status: quoteStatusSchema,
});
export type QuoteAcceptance = z.infer<typeof quoteAcceptanceSchema>;

/** Result of the I3 reproducibility check (the verification path). */
export const quoteReproductionSchema = z.object({
  quoteId: z.uuid(),
  reproduced: z.boolean(),
  /** Artifacts (or missing stamps) that diverged — empty when reproduced. */
  mismatches: z.array(z.string()),
});
export type QuoteReproduction = z.infer<typeof quoteReproductionSchema>;
