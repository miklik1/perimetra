/**
 * Quote store (CORE_SPEC §6, I3) — the frozen commercial artifact. A quote
 * captures EVERYTHING needed to re-derive itself forever: `stamps` (the exact
 * versioned inputs — releaseIds + catalog/price-table versions + override set,
 * the engine `SiteStamps`) and `snapshot` (the frozen outputs + the raw inputs
 * + the site graph). Re-derivation reloads the immutable stores by these stamps
 * and must reproduce the snapshot byte-for-byte (I3) — the verification path.
 *
 * Org-scoped via the ADR-0041 seam (activated ADR 0055). `projectId` is
 * nullable: a quote may freeze a transient site before project persistence
 * lands. The snapshot is immutable once issued (no update). Both `ownerId` and
 * `organizationId` are `onDelete: RESTRICT` — a frozen commercial artifact (I3)
 * must survive user/tenant deletion; GDPR erasure anonymizes `ownerId` rather
 * than cascading (ADR 0040/0055, legal-retention of commercial records).
 */
import {
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { id, timestamps } from "../../columns.js";
import { organization, user } from "../auth/index.js";
import { customer } from "../customers/index.js";
import { project } from "../projects/index.js";

export const QUOTE_STATUSES = ["draft", "issued", "accepted", "expired"] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export const quote = pgTable(
  "quote",
  {
    id: id(),
    /** Creator/audit ref (ADR 0055); RESTRICT so user deletion can't destroy an I3 artifact. */
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    /** THE access scope (ADR 0055) — NOT NULL; RESTRICT for I3 durability. */
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    /** Nullable until project persistence lands (a quote can freeze a transient site). */
    projectId: uuid("project_id").references(() => project.id, { onDelete: "set null" }),
    /** The attached buyer (odběratel, ADR 0082) — nullable (a quote may be issued
     *  without one). RESTRICT: a customer referenced by an issued quote is an I3
     *  dependency and is anonymized-in-place, never deleted (ADR 0071). */
    customerId: uuid("customer_id").references(() => customer.id, { onDelete: "restrict" }),
    status: text("status").notNull().$type<QuoteStatus>(),
    /** Gap-free, org-scoped, per-year document/evidence number (ADR 0079) —
     *  allocated INSIDE the issue tx (a rolled-back issue rolls back the
     *  increment, so no gaps). Format `{year}/{seq:04d}`; unique per org. This is
     *  the legal evidenční číslo on the document, not part of the I3 re-derivation
     *  (it's a row identifier, not an engine output). */
    documentNumber: text("document_number").notNull(),
    currency: text("currency").notNull(),
    shareToken: text("share_token").notNull(),
    validUntil: timestamp("valid_until", { withTimezone: true }),
    /** snapshot.money.total — the decimal-string total (I10), denormalized for
     *  list display and the margin-floor check. */
    totalMoney: text("total_money").notNull(),
    /** Price-table version denormalized for queries (authoritative copy in
     *  `stamps`). The catalog version is NO LONGER a scalar denorm: per-release
     *  catalog (ADR 0065) means a quote spans a MAP of releaseId→version, which
     *  has no single-column form — `stamps.catalogVersions` is the only copy. */
    priceTableVersion: integer("price_table_version").notNull(),
    /** Engine `SiteStamps` (I3 addressing). */
    stamps: jsonb("stamps").notNull(),
    /** Frozen outputs + raw inputs + site graph (re-derivation seed + display). */
    snapshot: jsonb("snapshot").notNull(),
    ...timestamps(),
  },
  (t) => [
    index("quote_org_id_id_idx").on(t.organizationId, t.id),
    uniqueIndex("quote_share_token_uq").on(t.shareToken),
    // Structural backstop for the gap-free series — no two quotes in an org can
    // share a document number even under a race (the atomic allocator serializes;
    // this guarantees it at the storage layer).
    uniqueIndex("quote_org_document_number_uq").on(t.organizationId, t.documentNumber),
  ],
);

export type QuoteRow = typeof quote.$inferSelect;
export type NewQuoteRow = typeof quote.$inferInsert;

/**
 * Per-org, per-year quote document-number counter (ADR 0079). One row per
 * (org, year); `lastNumber` is the last assigned sequence value (first
 * allocation returns 1). Allocation is a single atomic
 * `INSERT … ON CONFLICT DO UPDATE … RETURNING last_number` inside the issue
 * transaction — gap-free (a rolled-back issue rolls back the increment too) and
 * transaction-pooling-safe (no DB sequence, no advisory lock, no session GUC).
 * Operational state, NOT a legal artifact: the org FK CASCADEs (the immutable
 * `quote` rows carry I3 durability via RESTRICT, the counter need not).
 */
export const quoteNumberSequence = pgTable(
  "quote_number_sequence",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    year: integer("year").notNull(),
    lastNumber: integer("last_number").notNull(),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.year] })],
);

export type QuoteNumberSequenceRow = typeof quoteNumberSequence.$inferSelect;
