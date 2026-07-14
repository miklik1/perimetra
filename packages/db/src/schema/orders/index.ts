/**
 * Order schema (ADR 0109 / ADR-O1) — a thin REFERENCE entity over an accepted
 * quote's immutable snapshot. It never copies or mutates frozen data: the
 * commercial truth stays in exactly one place (the `quote` row it points at),
 * and the workshop production/traveler surfaces re-home by resolving
 * order → quote → snapshot (quotes.service). Conventions on display:
 *
 * - `quoteId` → `quote.id` `ON DELETE RESTRICT`: the frozen commercial basis
 *   must survive under the order (I3 durability; quotes are never deleted).
 * - `ownerId`/`organizationId` are `RESTRICT` (not the generic-scaffold
 *   `cascade`): an order is an I3-adjacent legal artifact — a user/org deletion
 *   must not destroy it. GDPR erasure anonymizes the user row instead (ADR 0071).
 * - `organizationId` is THE access scope (ADR 0041 seam, activated ADR 0055);
 *   `ownerId` is retained only as the creator/audit ref.
 * - NO soft-delete: an order is cancelled through the state machine
 *   (`order-lifecycle.ts`), never tombstoned — cancellation is a legal status,
 *   not a deletion.
 * - `order_quote_active_uq` (partial unique) makes "one live order per quote"
 *   structural: a cancelled order does not strand the quote, and two concurrent
 *   creates race to one winner at the storage layer.
 */
import { sql } from "drizzle-orm";
import { index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { id, timestamps } from "../../columns.js";
import { organization, user } from "../auth/index.js";
import { quote } from "../quotes/index.js";

// Stored statuses (plain text column + `$type`, no DB enum — additive, no
// migration; kept in lockstep with `@repo/validators/orders`). Order has no
// clock-derived status (no `expired` analogue): every status is stored.
export const ORDER_STATUSES = ["confirmed", "in_production", "completed", "cancelled"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const order = pgTable(
  "order",
  {
    id: id(),
    /** Creator/audit ref (ADR 0055) — RESTRICT: an order outlives its creator. */
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    /** THE access scope (ADR 0041 seam, ADR 0055) — RESTRICT for I3 durability. */
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    /** The accepted, frozen commercial basis — never copied, only referenced. */
    quoteId: uuid("quote_id")
      .notNull()
      .references(() => quote.id, { onDelete: "restrict" }),
    /** Operational handle `Z{year}/{seq:04d}` (NOT a statutory tax number). */
    orderNumber: text("order_number").notNull(),
    status: text("status").notNull().$type<OrderStatus>(),
    /** Required on cancel (service guard); null otherwise. */
    cancelReason: text("cancel_reason"),
    ...timestamps(),
  },
  (t) => [
    index("order_org_id_id_idx").on(t.organizationId, t.id),
    uniqueIndex("order_org_number_uq").on(t.organizationId, t.orderNumber),
    // One LIVE order per quote — a cancelled order does not strand the quote.
    uniqueIndex("order_quote_active_uq")
      .on(t.quoteId)
      .where(sql`${t.status} <> 'cancelled'`),
  ],
);

export type OrderRow = typeof order.$inferSelect;
export type NewOrderRow = typeof order.$inferInsert;
