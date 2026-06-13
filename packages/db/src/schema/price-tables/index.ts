/**
 * Price-table store (CORE_SPEC §6, I3) — per-tenant, versioned, immutable price
 * tables with effective-date windows (no yearly clones; a new window is a new
 * version row). Owner-scoped today via the ADR-0041 seam (the org retrofit
 * flips `scoped()` to organizationId in one place, with every other module).
 *
 * Append-only: no update/delete surface — a version a quote stamped must
 * re-derive forever (I3). `effectiveTo` is the one mutable lifecycle field a
 * later admin flow may set when a successor opens (the price DATA never moves).
 *
 * - `version` is the number stamped on every engine result (`prices.version`);
 *   unique per owner so a stamped `priceTableVersion` resolves to ONE table.
 * - `table` is the engine `PriceTable` JSONB (components + manufacturing +
 *   installation); the engine consumes it as a pure data argument — prices are
 *   NOT money-string here (ADR 0045 numeric domain), they cross the I10
 *   boundary only as result totals.
 * - `currency`, `marginFloorPct`, `dphRate`, `reverseCharge` are the commercial
 *   guardrails (CORE_SPEC §6); margin floor + DPH are applied APP-side at quote
 *   issue / invoice, never inside the deterministic engine.
 */
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { id, timestamps } from "../../columns.js";
import { organization, user } from "../auth/index.js";

export const PRICE_TABLE_CURRENCIES = ["CZK", "EUR"] as const;
export type PriceTableCurrency = (typeof PRICE_TABLE_CURRENCIES)[number];

export const priceTable = pgTable(
  "price_table",
  {
    id: id(),
    /** Ownership scope (ADR 0041) — the org retrofit flips `scoped()` to org. */
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Dormant tenancy seam (ADR 0041) — populated, retrofit flips scope to it. */
    organizationId: text("organization_id").references(() => organization.id, {
      onDelete: "set null",
    }),
    /** The stamped `prices.version` (I3) — unique per owner. */
    version: integer("version").notNull(),
    currency: text("currency").notNull().$type<PriceTableCurrency>(),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
    /** Open-ended when null (the current table); a successor closes it. */
    effectiveTo: timestamp("effective_to", { withTimezone: true }),
    /** Margin floor as a percent (decimal-as-string); null = no floor. */
    marginFloorPct: numeric("margin_floor_pct"),
    /** DPH/VAT rate as a percent (decimal-as-string), e.g. "21". */
    dphRate: numeric("dph_rate").notNull(),
    reverseCharge: boolean("reverse_charge").notNull().default(false),
    /** Engine `PriceTable` payload (JSONB); typed at the apps/api edge. */
    table: jsonb("table").notNull(),
    ...timestamps(),
  },
  (t) => [
    // A stamped (owner, version) resolves to exactly one immutable table (I3).
    uniqueIndex("price_table_owner_version_uq").on(t.ownerId, t.version),
    // resolveActive(owner, asOf): scan the owner's windows by effectiveFrom.
    index("price_table_owner_effective_idx").on(t.ownerId, t.effectiveFrom),
  ],
);

export type PriceTableRow = typeof priceTable.$inferSelect;
export type NewPriceTableRow = typeof priceTable.$inferInsert;
