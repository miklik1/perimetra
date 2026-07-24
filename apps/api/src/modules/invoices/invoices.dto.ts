/**
 * nestjs-zod DTOs over the shared contracts (`@repo/validators/invoices`) — the
 * classes give Nest something to hang pipe/serializer metadata on; the zod
 * schemas stay the single source of truth.
 */
import {
  invoiceDocumentSchema,
  invoiceReproductionSchema,
  invoiceSchema,
  invoicesPageSchema,
  issueInvoiceSchema,
  listInvoicesQuerySchema,
  markInvoicePaidSchema,
} from "@repo/validators/invoices";

import { createZodDto } from "../../common/api/zod.js";

export class IssueInvoiceDto extends createZodDto(issueInvoiceSchema) {}
export class MarkInvoicePaidDto extends createZodDto(markInvoicePaidSchema) {}
export class ListInvoicesQueryDto extends createZodDto(listInvoicesQuerySchema) {}

/** Response DTOs — used with `@ZodSerializerDto` (strip semantics, spec §8). */
export class InvoiceDto extends createZodDto(invoiceSchema) {}
export class InvoicesPageDto extends createZodDto(invoicesPageSchema) {}
export class InvoiceReproductionDto extends createZodDto(invoiceReproductionSchema) {}
/** The frozen §29 document projected through the kernel's view-model builder
 *  (ADR 0127) — strip semantics are what keep the parsed-but-unsurfaced frozen
 *  fields (buyerEmail, discrete addresses, per-line regime) off the wire. */
export class InvoiceDocumentDto extends createZodDto(invoiceDocumentSchema) {}
