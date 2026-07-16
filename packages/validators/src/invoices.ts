/**
 * Invoice contracts (ADR 0112, ADR-O2) — the api↔frontend seam for the second
 * frozen document class. An invoice is ISSUED from an accepted quote's `order`
 * (`issueInvoiceSchema`), freezes into an immutable §29 daňový doklad, and is
 * then only ever marked paid/unpaid (row state) or superseded — never edited.
 *
 * The wire carries the built `ExportableDocument` on the DETAIL response as an
 * opaque passthrough (`snapshot`, the kernel's own valid output — the print
 * surface consumes it, O2-c); the SUMMARY/list shape stays a thin projection.
 * Money is the I10 decimal koruna string on the wire (haléře stays inside the
 * kernel/snapshot). Every endpoint is admin/sales-gated — workshop is
 * price-blind by ABSENCE (403), so there is no price-blind projection here.
 */
import { z } from "zod";

import { cursorQuerySchema, paginated } from "./api/pagination";
import { isoDate, isoDatetime } from "./primitives";

export const INVOICE_STATUSES = ["issued", "paid"] as const;
export const invoiceStatusSchema = z.enum(INVOICE_STATUSES);
export type InvoiceStatus = z.infer<typeof invoiceStatusSchema>;

/** Document payment method — mirrors `@cardo/tax-cz` `DOCUMENT_PAYMENT_METHODS`
 *  (what the tax document PRINTS, distinct from an order's checkout rail). */
export const invoicePaymentMethodSchema = z.enum(["bank_transfer", "cash", "card", "cod"]);
export type InvoicePaymentMethod = z.infer<typeof invoicePaymentMethodSchema>;

/** Tax mode — mirrors `@repo/model` `TAX_MODES`. */
export const invoiceTaxModeSchema = z.enum(["standard_vat", "reverse_charge_92e"]);

/**
 * Issue an invoice from an order. Dates default server-side (issue = today in
 * Prague, DUZP = issue, due = issue + 14d) when omitted. The §21 tax overrides
 * (`ratePctOverride`/`modeOverride`) express a VAT-law change BETWEEN quote and
 * invoice without touching frozen history (ADR 0112 §4) and are audited; absent
 * ⇒ the quote's stamped rate + frozen mode carry through unchanged.
 */
export const issueInvoiceSchema = z.object({
  orderId: z.uuid(),
  issuedOn: isoDate.optional(),
  duzp: isoDate.optional(),
  dueOn: isoDate.optional(),
  paymentMethod: invoicePaymentMethodSchema.optional(),
  /** Override the per-rate VAT percent (e.g. "21" → "12"); audited (§21). */
  ratePctOverride: z
    .string()
    .regex(/^\d+(\.\d+)?$/)
    .optional(),
  /** Override the tax mode (standard vs §92e reverse charge); audited. */
  modeOverride: invoiceTaxModeSchema.optional(),
  note: z.string().max(500).optional(),
});
export type IssueInvoiceInput = z.infer<typeof issueInvoiceSchema>;

/** Mark an issued invoice as paid (admin-only) — a free-text bank-reference note. */
export const markInvoicePaidSchema = z.object({
  note: z.string().max(500).optional(),
});
export type MarkInvoicePaidInput = z.infer<typeof markInvoicePaidSchema>;

/** Summary/list projection — every list-visible field, no frozen payloads. */
export const invoiceSummarySchema = z.object({
  id: z.uuid(),
  orderId: z.uuid(),
  documentNumber: z.string(),
  status: invoiceStatusSchema,
  currency: z.string(),
  issuedOn: isoDate,
  duzp: isoDate,
  dueOn: isoDate,
  variableSymbol: z.string(),
  /** Gross (payable) total, I10 decimal koruna string. */
  total: z.string(),
  supersededById: z.uuid().nullable(),
  paidAt: isoDatetime.nullable(),
  paidNote: z.string().nullable(),
  createdAt: isoDatetime,
  updatedAt: isoDatetime,
});
export type InvoiceSummary = z.infer<typeof invoiceSummarySchema>;

/** Detail response — the summary plus the frozen `ExportableDocument` (opaque
 *  passthrough, the kernel's own valid output the print surface renders). */
export const invoiceSchema = invoiceSummarySchema.extend({
  snapshot: z.unknown(),
});
export type Invoice = z.infer<typeof invoiceSchema>;

export const listInvoicesQuerySchema = cursorQuerySchema.extend({
  status: invoiceStatusSchema.optional(),
});
export type ListInvoicesQuery = z.infer<typeof listInvoicesQuerySchema>;

export const invoicesPageSchema = paginated(invoiceSummarySchema);
export type InvoicesPage = z.infer<typeof invoicesPageSchema>;

/** Result of the I3 reproducibility check — re-run `buildInvoice(facts)` and
 *  deep-equal against the frozen `snapshot` (ADR 0112 §6). */
export const invoiceReproductionSchema = z.object({
  invoiceId: z.uuid(),
  reproduced: z.boolean(),
  /** Snapshot keys that diverged — empty when reproduced. */
  mismatches: z.array(z.string()),
});
export type InvoiceReproduction = z.infer<typeof invoiceReproductionSchema>;
