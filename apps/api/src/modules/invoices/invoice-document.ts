/**
 * The pure §29 DOCUMENT projection (ADR 0127) — parse the frozen
 * `invoice.snapshot` and hand it to the KERNEL's own `buildPdfViewModel`.
 *
 * Pure, zero I/O, tested standalone; the structural precedent is
 * `apps/api/src/modules/quotes/production.ts`. It returns a RESULT rather than
 * throwing — the service owns the HTTP shape.
 *
 * NOTHING is re-derived here. The §92e legend, the document-type label, the
 * payment-method label and every money string come out of the kernel
 * (`REVERSE_CHARGE_LEGEND_CS`, `DOCUMENT_TYPE_LABELS`, `PAYMENT_METHOD_LABELS`,
 * `formatCents`). A second CZ tax/legend/format code path on a regulated
 * document is the worst possible outcome (the 2026-07-14 no-duplication ruling),
 * so this module contains exactly one decision: parse or refuse.
 *
 * FAIL CLOSED (ADR 0126's inversion rule): a frozen payload that will not parse
 * yields `{ ok: false }`, never a partial or `null`-filled document. On a §29
 * daňový doklad a missing field is a DEFECT, not honesty.
 *
 * The `reason` is a zod PATH only, NEVER a value — the frozen snapshot carries
 * the buyer's full identity and none of it may reach a log line or an error body.
 */
import { buildPdfViewModel } from "@cardo/tax-cz/export";
import type { ExportableDocument, ExportableIssuer, PdfViewModel } from "@cardo/tax-cz/export";

import { type InvoiceDocument } from "@repo/validators/invoices";

import { exportableDocumentSchema } from "./exportable-document.js";

/**
 * The issuer view `buildPdfViewModel` reads. It touches EXACTLY two fields —
 * `email` (→ `supplierEmail`) and `issuingSystem` — and never the rest of
 * `ExportableIssuer`, which exists for the XML export seam this repo does not
 * call.
 *
 * FREEZE HONESTY (ADR 0126 / ADR 0127): `email` is NOT read live from the org
 * legal profile. It CANNOT be — `legalProfileSchema` carries no e-mail field and
 * `legal_profile` has no such column (adding one would have to go through
 * `pii()`, see `packages/db/src/schema/legal-profiles/index.ts`). `null` is the
 * only honest value, and the print sheet renders an absence ("—") rather than a
 * masked or invented one (the ADR-0108 precedent).
 */
const PDF_ISSUER: ExportableIssuer = {
  email: null,
  issuingSystem: "Perimetra",
  // Structurally required by the interface, never read by buildPdfViewModel.
  // Pinned by a test that asserts none of these strings reaches the output.
  isVatPayer: false,
  anonymousIdScheme: "Perimetra:anonymous",
  exportApplication: "Perimetra",
  exportNote: "",
};

/**
 * Compile-time proof that the WIRE contract mirrors the kernel view model
 * field-for-field. `MirroredDocument` resolves to `InvoiceDocument` only while
 * the two are MUTUALLY assignable and to `never` otherwise — so a kernel field
 * added, removed or renamed breaks `project()` below at BUILD time, never at
 * runtime as a silently-stripped response field.
 */
type Mutual<A, B> = A extends B ? (B extends A ? A : never) : never;
type MirroredDocument = Mutual<InvoiceDocument, PdfViewModel>;

export type InvoiceDocumentResult =
  | { ok: true; document: InvoiceDocument }
  | { ok: false; reason: string };

/**
 * Project a frozen `invoice.snapshot` into the pure §29 document view.
 *
 * @param snapshot the stored JSONB, typed `unknown` on purpose — the column is
 *   opaque and untrusted until this guard parses it.
 */
export function buildInvoiceDocumentView(snapshot: unknown): InvoiceDocumentResult {
  const parsed = exportableDocumentSchema.safeParse(snapshot);
  if (!parsed.success) {
    // A PATH, never a value — see the module docblock.
    return { ok: false, reason: parsed.error.issues[0]?.path.join(".") || "snapshot" };
  }
  return { ok: true, document: project(parsed.data) };
}

/** The parsed copy is typed as the KERNEL POJO on the way in (a second
 *  compile-time check that the zod mirror above really produces an
 *  `ExportableDocument`) and as the mirrored wire type on the way out. */
function project(doc: ExportableDocument): MirroredDocument {
  return buildPdfViewModel(doc, PDF_ISSUER, doc.lines);
}
