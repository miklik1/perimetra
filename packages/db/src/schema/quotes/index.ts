/**
 * Quote store (CORE_SPEC §6, I3) — the frozen commercial artifact. A quote
 * captures EVERYTHING needed to re-derive itself forever: `stamps` (the exact
 * versioned inputs — releaseIds + catalog/price-table versions + override set,
 * the engine `SiteStamps`) and `snapshot` (the frozen outputs + the raw inputs
 * + the site graph). Re-derivation reloads the immutable stores by these stamps
 * and must reproduce the snapshot byte-for-byte (I3) — the verification path.
 *
 * Owner-scoped via the ADR-0041 seam (org retrofit flips `scoped()` with every
 * module). `projectId` is nullable: a quote may freeze a transient site before
 * project persistence lands. The snapshot is immutable once issued (no update).
 */
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { id, timestamps } from "../../columns.js";
import { organization, user } from "../auth/index.js";
import { project } from "../projects/index.js";

export const QUOTE_STATUSES = ["draft", "issued", "accepted", "expired"] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export const quote = pgTable(
  "quote",
  {
    id: id(),
    /** Ownership scope (ADR 0041) — the org retrofit flips `scoped()` to org. */
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    organizationId: text("organization_id").references(() => organization.id, {
      onDelete: "set null",
    }),
    /** Nullable until project persistence lands (a quote can freeze a transient site). */
    projectId: uuid("project_id").references(() => project.id, { onDelete: "set null" }),
    status: text("status").notNull().$type<QuoteStatus>(),
    currency: text("currency").notNull(),
    shareToken: text("share_token").notNull(),
    validUntil: timestamp("valid_until", { withTimezone: true }),
    /** snapshot.money.total — the decimal-string total (I10), denormalized for
     *  list display and the margin-floor check. */
    totalMoney: text("total_money").notNull(),
    /** Stamp denormalizations for queries (the authoritative copies live in `stamps`). */
    catalogVersion: integer("catalog_version").notNull(),
    priceTableVersion: integer("price_table_version").notNull(),
    /** Engine `SiteStamps` (I3 addressing). */
    stamps: jsonb("stamps").notNull(),
    /** Frozen outputs + raw inputs + site graph (re-derivation seed + display). */
    snapshot: jsonb("snapshot").notNull(),
    ...timestamps(),
  },
  (t) => [
    index("quote_owner_id_id_idx").on(t.ownerId, t.id),
    uniqueIndex("quote_share_token_uq").on(t.shareToken),
  ],
);

export type QuoteRow = typeof quote.$inferSelect;
export type NewQuoteRow = typeof quote.$inferInsert;
