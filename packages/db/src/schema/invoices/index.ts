/**
 * Invoice store (ADR 0112, ADR-O2) — the SECOND frozen document class (after the
 * quote, ADR 0053). An issued invoice is a §29 daňový doklad: an immutable,
 * re-derivable legal artifact. It never copies or mutates the quote — it
 * references the `order` (and through it the accepted quote's frozen snapshot)
 * and freezes TWO JSONB payloads of its own:
 *
 *  - `facts`    — the exact `BuildInvoiceInput` (the kernel's ergonomic builder
 *                 input): identity/dates/numbering + per-rate gross lines in
 *                 haléře. Freezing the BUILDER INPUT (not a smaller mapper input)
 *                 makes reproduction self-contained — a re-run of `buildInvoice`
 *                 over `facts` reproduces `snapshot` byte-for-byte with zero
 *                 dependence on any live table (the ADR-0112 §6 harness).
 *  - `snapshot` — the built `ExportableDocument` (the kernel-rendered §29 document
 *                 output: per-(regime,rate) VAT recap + totals + parties).
 *
 * Money on both payloads is INTEGER HALÉŘE (the `@cardo/tax-cz` convention); the
 * koruna↔haléře reconciliation is the mapper's sole numeric job (ADR 0112 §2).
 *
 * Durability (ADR 0112 §1): `owner_id`/`organization_id`/`order_id` are all
 * `onDelete: RESTRICT` — a §29 document with a 10-year statutory retention
 * (§35 ZDPH) must survive user/tenant/order deletion; GDPR erasure anonymizes
 * the user row instead (ADR 0071), never cascades. There is NO soft-delete: a
 * wrong invoice is SUPERSEDED (the `superseded_by_id` chain), never tombstoned —
 * replacement, not deletion (ADR 0112 §7). Payment status is ROW STATE
 * (`status`/`paid_at`/`paid_note`), never document content (mutating the frozen
 * snapshot is forbidden by construction).
 */
import { sql } from "drizzle-orm";
import {
  date,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

import { id, timestamps } from "../../columns.js";
import { organization, user } from "../auth/index.js";
import { order } from "../orders/index.js";

// Stored statuses (plain text column + `$type`, no DB enum — additive, no
// migration; kept in lockstep with `@repo/validators/invoices`). Both are
// STORED (no clock-derived status): "issued" on freeze, "paid" once an admin
// marks the bank payment received (ADR 0112 §5/§7).
export const INVOICE_STATUSES = ["issued", "paid"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const invoice = pgTable(
  "invoice",
  {
    id: id(),
    /** Creator/audit ref (ADR 0055) — RESTRICT: an I3 legal artifact outlives its creator. */
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    /** THE access scope (ADR 0041 seam, ADR 0055) — RESTRICT for I3 durability. */
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    /** The order being invoiced — the frozen commercial basis, never copied.
     *  RESTRICT: the order (→ accepted quote) must survive under the invoice. */
    orderId: uuid("order_id")
      .notNull()
      .references(() => order.id, { onDelete: "restrict" }),
    /** Gap-free, org-scoped, per-year evidence number (§29 odst. 1 písm. e),
     *  series `"invoice"` in the shared `document_number_sequence` (ADR 0109);
     *  format `FV{year}/{seq:04d}` (PROVISIONAL, accountant-gated — CAR-27). */
    documentNumber: text("document_number").notNull(),
    status: text("status").notNull().$type<InvoiceStatus>(),
    /** Replacement chain (ADR 0112 §7): the invoice that supersedes this one.
     *  The ONE mutable pointer on an otherwise-frozen row; UNIQUE keeps chains
     *  linear; null = the live head. v1 has no in-system correction — a wrong
     *  invoice is superseded, an opravný doklad is issued outside the system. */
    supersededById: uuid("superseded_by_id").references((): AnyPgColumn => invoice.id),
    currency: text("currency").notNull(),
    /** §29 dates (calendar dates, not timestamps): issue date, DUZP (datum
     *  uskutečnění zdanitelného plnění — §21 ties the VAT rate to it), due date. */
    issuedOn: date("issued_on").notNull(),
    duzp: date("duzp").notNull(),
    dueOn: date("due_on").notNull(),
    /** Bank variabilní symbol — digits ≤10, derived from the document number
     *  (kernel `variableSymbolFromNumber`); frozen into `facts.payment` too. */
    variableSymbol: text("variable_symbol").notNull(),
    /** Gross (payable) total as an I10 decimal koruna string — denormalized for
     *  lists (the authoritative copy is `snapshot.totalCents`, haléře). */
    totalMoney: text("total_money").notNull(),
    /** Frozen `BuildInvoiceInput` (the exact builder input — re-run seed, §6). */
    facts: jsonb("facts").notNull(),
    /** Frozen `ExportableDocument` (the built kernel output). */
    snapshot: jsonb("snapshot").notNull(),
    /** Payment marked received (ADR 0112 §5) — row state, never document content. */
    paidAt: timestamp("paid_at", { withTimezone: true }),
    paidNote: text("paid_note"),
    ...timestamps(),
  },
  (t) => [
    index("invoice_org_id_id_idx").on(t.organizationId, t.id),
    // Structural backstop for the gap-free §29 series — no two invoices in an
    // org share a document number even under a race (the allocator serializes).
    uniqueIndex("invoice_org_document_number_uq").on(t.organizationId, t.documentNumber),
    // One LIVE invoice per order — a superseded invoice does not block a re-issue,
    // and a double-click races to one winner at the storage layer (→ 409).
    uniqueIndex("invoice_order_active_uq")
      .on(t.orderId)
      .where(sql`${t.supersededById} IS NULL`),
    // Linear supersede chains — no two invoices share a superseding replacement.
    uniqueIndex("invoice_superseded_by_id_uq").on(t.supersededById),
  ],
);

export type InvoiceRow = typeof invoice.$inferSelect;
export type NewInvoiceRow = typeof invoice.$inferInsert;
