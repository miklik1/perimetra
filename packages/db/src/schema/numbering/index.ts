/**
 * Document numbering (ADR 0109 / ADR-O1) — the generalized ADR 0079 gap-free
 * allocator. `document_number_sequence(org, series, year, last_number)` is the
 * ONE counter table serving every numbered document class (`"order"` today;
 * `"invoice"` at ADR-O2/CAR-157; the quote counter migrates in at O2-a). One
 * allocator, one continuity story for the accountant.
 *
 * Like `quote_number_sequence` (which it supersedes), the org FK is `CASCADE`:
 * the counter is OPERATIONAL state, not a legal artifact — the durable legal
 * strings live on the immutable document rows (quote/order/invoice), each with
 * its own `(organizationId, <number>)` unique backstop. Pooling-safe by
 * construction: an atomic upsert under the row lock, no DB sequence / advisory
 * lock / session GUC (CLAUDE.md transaction-pooling doctrine).
 */
import { integer, pgTable, primaryKey, text } from "drizzle-orm/pg-core";

import { timestamps } from "../../columns.js";
import { organization } from "../auth/index.js";

export const documentNumberSequence = pgTable(
  "document_number_sequence",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** Document class: `"order"`, `"invoice"`, `"quote"` (each an independent series). */
    series: text("series").notNull(),
    year: integer("year").notNull(),
    /** Last assigned sequence value; the first allocation returns 1. */
    lastNumber: integer("last_number").notNull(),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.series, t.year] })],
);

export type DocumentNumberSequenceRow = typeof documentNumberSequence.$inferSelect;
