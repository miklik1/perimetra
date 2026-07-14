/**
 * Deviation ledger schema (ADR 0110 / ADR-O4, CAR-159) — a REBUILDABLE
 * write-through PROJECTION, not a legal record. Rows are written in the same tx
 * as their source act (quote-scope override at issue, margin override, order
 * exception); the FROZEN quote snapshots stay the only truth, and a rebuild
 * re-projects the snapshot-derivable rows. So the org FK CASCADEs and rows are
 * disposable — deliberately weaker durability than quotes/invoices (a lost
 * projection is repairable; a lost quote is not).
 *
 * The engine's pure `recurrenceReport` (ADR 0048 `packages/engine/src/ledger.ts`)
 * runs over the `quote_override` rows for the vendor ETO→CTO promotion queue.
 */
import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { id } from "../../columns.js";
import { organization, user } from "../auth/index.js";
import { order } from "../orders/index.js";
import { quote } from "../quotes/index.js";

// The act a ledger row projects. `quote_override` is snapshot-derivable (rebuilt);
// `margin_override` (audit-backed) and `order_exception` are authoritative direct
// writes. Plain text + `$type`, kept in lockstep with `@repo/validators/ledger`.
export const DEVIATION_SOURCES = ["quote_override", "margin_override", "order_exception"] as const;
export type DeviationSource = (typeof DEVIATION_SOURCES)[number];

export const deviationLedger = pgTable(
  "deviation_ledger",
  {
    id: id(),
    /** CASCADE — a rebuildable projection, not an I3 legal artifact. */
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** The quote the deviation belongs to (CASCADE with the projection). */
    quoteId: uuid("quote_id")
      .notNull()
      .references(() => quote.id, { onDelete: "cascade" }),
    /** Set only for `order_exception` rows; SET NULL if the order is removed. */
    orderId: uuid("order_id").references(() => order.id, { onDelete: "set null" }),
    source: text("source").notNull().$type<DeviationSource>(),
    /** `Override.kind` — "param"|"price"|"artifact" (null for margin/order rows). */
    kind: text("kind"),
    /** `Override.target` — the exact grouping key for the recurrence report. */
    target: text("target"),
    value: jsonb("value"),
    reason: text("reason").notNull().default(""),
    /** The acting user (SET NULL on user removal — GDPR); null for buyer-driven. */
    actorId: text("actor_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("deviation_ledger_org_target_idx").on(t.organizationId, t.target),
    index("deviation_ledger_org_quote_idx").on(t.organizationId, t.quoteId),
  ],
);

export type DeviationLedgerRow = typeof deviationLedger.$inferSelect;
export type NewDeviationLedgerRow = typeof deviationLedger.$inferInsert;
