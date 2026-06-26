/**
 * Customer (odběratel) schema (ADR 0082) — the buyer entity a quote attaches to.
 * Org-scoped LIVE data (the generated owner-scoped template flipped to the
 * ADR-0055 seam): `organizationId` is THE access scope (NOT NULL); `ownerId` is
 * the owning rep (per-rep ownership layered on top — a sales rep sees only their
 * own customers, admin sees the whole org).
 *
 * PII (ADR 0040/0071): the buyer-identifying columns are `pii()`-wrapped so the
 * GDPR export/erasure machinery + log redaction cover them. A customer is the
 * ERASABLE record of truth — `anonymize` scrubs the live row in place (never a
 * hard delete) so an issued quote that froze the buyer fields into its immutable
 * snapshot keeps re-deriving (I3); `quote.customer_id` is `ON DELETE RESTRICT`.
 * `dic` (DIČ) drives the §92e reverse-charge decision via `vatPayer`.
 */
import { sql } from "drizzle-orm";
import { boolean, index, pgTable, text } from "drizzle-orm/pg-core";

import { id, softDelete, timestamps } from "../../columns.js";
import { pii } from "../../pii.js";
import { organization, user } from "../auth/index.js";

export const CUSTOMER_STATUSES = ["active", "archived"] as const;
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];

export const customer = pgTable(
  "customer",
  {
    id: id(),
    /** THE access scope (ADR 0055) — NOT NULL. Org data; org deletion is guarded
     *  upstream by the I3 quote→org RESTRICT, so cascade is safe here. */
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** The owning rep (per-rep ownership + audit). RESTRICT so user erasure
     *  anonymizes the user row rather than cascade-deleting org customers (ADR 0055). */
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    /** Buyer name / company name. */
    name: pii("customer.name", text("name").notNull()),
    /** IČO — Czech business identifier (a sole trader's is personal data). */
    ico: pii("customer.ico", text("ico")),
    /** DIČ — Czech VAT identifier ("CZ" + 8–10 digits). */
    dic: pii("customer.dic", text("dic")),
    /** Registered CZ VAT payer — load-bearing for the §92e decision (ADR 0080). */
    vatPayer: boolean("vat_payer").notNull().default(false),
    email: pii("customer.email", text("email")),
    phone: pii("customer.phone", text("phone")),
    addressLine: pii("customer.address_line", text("address_line")),
    city: pii("customer.city", text("city")),
    postalCode: pii("customer.postal_code", text("postal_code")),
    /** ISO country (default CZ) — not personal data. */
    country: text("country").notNull().default("CZ"),
    note: text("note"),
    status: text("status").notNull().default("active").$type<CustomerStatus>(),
    ...timestamps(),
    ...softDelete(),
  },
  (table) => [
    // THE list query: per-org, per-rep, live rows. Partial — soft-deleted rows
    // leave the index. (org, owner, id) supports both the admin (org-wide) and
    // the rep-restricted (owner-filtered) scans, keyset by id.
    index("customer_org_owner_id_idx")
      .on(table.organizationId, table.ownerId, table.id)
      .where(sql`${table.deletedAt} IS NULL`),
  ],
);

export type CustomerRow = typeof customer.$inferSelect;
export type NewCustomerRow = typeof customer.$inferInsert;
