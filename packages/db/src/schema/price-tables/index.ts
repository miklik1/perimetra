/**
 * Price-table store (CORE_SPEC §6, I3) — per-tenant, versioned, immutable price
 * tables with effective-date windows (no yearly clones; a new window is a new
 * version row). Org-scoped via the ADR-0041 seam (activated ADR 0055). Both
 * `ownerId` and `organizationId` are `onDelete: RESTRICT` — a stamped table an
 * issued quote depends on (I3) must survive user/tenant deletion.
 *
 * Append-only: no update/delete surface — a version a quote stamped must
 * re-derive forever (I3). `effectiveTo` is the one mutable lifecycle field a
 * later admin flow may set when a successor opens (the price DATA never moves).
 *
 * - `version` is the number stamped on every engine result (`prices.version`);
 *   unique per ORG (ADR 0055) so a stamped `priceTableVersion` resolves to ONE table.
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
    /** Creator/audit ref (ADR 0055); RESTRICT so user deletion can't break I3 re-derivation. */
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    /** THE access scope (ADR 0055) — NOT NULL; RESTRICT for I3 durability. */
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "restrict" }),
    /** The stamped `prices.version` (I3) — unique per ORG (ADR 0055). */
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
    // A stamped (org, version) resolves to exactly one immutable table (I3).
    uniqueIndex("price_table_org_version_uq").on(t.organizationId, t.version),
    // resolveActive(org, asOf): scan the org's windows by effectiveFrom.
    index("price_table_org_effective_idx").on(t.organizationId, t.effectiveFrom),
  ],
);

export type PriceTableRow = typeof priceTable.$inferSelect;
export type NewPriceTableRow = typeof priceTable.$inferInsert;
