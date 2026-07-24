/**
 * Runtime parse guard for the FROZEN `invoice.snapshot` JSONB (ADR 0127) — the
 * first runtime schema for either of this module's JSONB columns anywhere in the
 * repo.
 *
 * It is a hand-kept MIRROR of the kernel's `@cardo/tax-cz/export`
 * `ExportableDocument` / `ExportableLine` / `VatSummaryRow` POJOs, and it lives
 * HERE rather than in `@repo/validators` deliberately: it mirrors a KERNEL type
 * that only `apps/api` may import (the `/export` index eagerly constructs the
 * ISDOC/UBL exporters and pulls native `libxmljs2` + `saxon-js`), and it is a
 * parse guard over stored bytes — not an api↔web wire contract. The lockstep
 * obligation is the same precedent as `invoicePaymentMethodSchema` and the
 * `OrgRole` tuple: when the kernel POJO changes, this changes with it.
 *
 * `paymentMethod` REUSES `invoicePaymentMethodSchema` from `@repo/validators`
 * so there is exactly ONE payment-method vocabulary in the repo.
 *
 * Notes that are load-bearing, not stylistic:
 *
 * - The dates are validated as PLAIN STRINGS, not `isoDate`. This guard exists
 *   to prove the payload is STRUCTURALLY buildable; a stricter date-format check
 *   here would turn a legitimately-frozen historical document into a 422. The
 *   response schema (`invoiceDocumentSchema`) re-validates the format on the way
 *   OUT, where refusing is safe because the row was already read.
 * - `buyerEmail`, the discrete address components, `id`, and the per-line
 *   `regime` / `khSubjectCode` are PARSED (they are part of the frozen shape)
 *   but `buildPdfViewModel` does not surface them — so the document response
 *   carries strictly less than the already-shipped `GET /v1/invoices/:id`.
 * - Zod's default STRIP semantics are correct here: an older frozen document may
 *   carry keys this mirror does not know, and dropping them from the parsed copy
 *   changes nothing the view model reads. Stripping never mutates the stored row.
 */
import { z } from "zod";

import { invoicePaymentMethodSchema } from "@repo/validators/invoices";

/** Mirrors `VAT_REGIMES` (`@cardo/tax-cz` vat.ts). */
const vatRegimeSchema = z.enum(["standard", "reduced", "zero_rated", "exempt", "reverse_charge"]);

/** Mirrors `DOCUMENT_TYPES` (`@cardo/tax-cz` document.ts). */
const documentTypeSchema = z.enum(["invoice", "credit_note", "advance_receipt"]);

const vatSummaryRowSchema = z.object({
  ratePercent: z.number(),
  regime: vatRegimeSchema,
  grossCents: z.number(),
  baseCents: z.number(),
  vatCents: z.number(),
});

const exportableLineSchema = z.object({
  index: z.number().int(),
  description: z.string(),
  quantity: z.number(),
  unit: z.string(),
  lineBaseCents: z.number(),
  lineVatCents: z.number(),
  lineGrossCents: z.number(),
  vatRatePercent: z.number(),
  regime: vatRegimeSchema,
  foreignBaseCents: z.number().nullable(),
  foreignGrossCents: z.number().nullable(),
  khSubjectCode: z.string().nullable(),
});

export const exportableDocumentSchema = z.object({
  id: z.string(),
  number: z.string(),
  type: documentTypeSchema,
  issueDate: z.string(),
  duzpDate: z.string(),
  dueDate: z.string().nullable(),
  currency: z.string(),
  exchangeRate: z.number().nullable(),
  foreignTotalCents: z.number().nullable(),
  foreignVatSummary: z.array(vatSummaryRowSchema).nullable(),
  reverseCharge: z.boolean(),
  supplierName: z.string(),
  supplierAddress: z.string(),
  supplierIco: z.string(),
  supplierDic: z.string().nullable(),
  supplierBankAccount: z.string().nullable(),
  supplierIban: z.string().nullable(),
  supplierStreet: z.string().nullable(),
  supplierCity: z.string().nullable(),
  supplierPostalCode: z.string().nullable(),
  supplierCountryCode: z.string().nullable(),
  buyerName: z.string(),
  buyerAddress: z.string(),
  buyerIco: z.string().nullable(),
  buyerDic: z.string().nullable(),
  buyerEmail: z.string().nullable(),
  buyerStreet: z.string().nullable(),
  buyerCity: z.string().nullable(),
  buyerPostalCode: z.string().nullable(),
  buyerCountryCode: z.string().nullable(),
  buyerPeppol: z.object({ scheme: z.string(), id: z.string() }).nullable().optional(),
  variableSymbol: z.string(),
  paymentMethod: invoicePaymentMethodSchema,
  subtotalBaseCents: z.number(),
  vatTotalCents: z.number(),
  roundingCents: z.number(),
  totalCents: z.number(),
  vatSummary: z.array(vatSummaryRowSchema),
  lines: z.array(exportableLineSchema),
  correctsNumber: z.string().nullable(),
  note: z.string().nullable(),
});
