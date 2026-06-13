/**
 * Catalog-version store (CORE_SPEC §2, I3) — immutable, global, vendor-authored
 * catalog releases (`catalog@N`). Unlike the reference resource
 * (`schema/projects`) this is NOT owner/tenant-scoped and NOT soft-deletable: a
 * catalog version is global data, append-only, never mutated or deleted — a
 * quote stamped against `version` must re-derive forever (I3). Writes are
 * admin-gated at the app layer (RoleGuard lands with the roles slice).
 *
 * - `id()` UUIDv7 surrogate: the keyset-pagination cursor.
 * - `version` is the natural key (`Catalog.version`); the unique index makes
 *   "one row per version" a structural guarantee (no second `catalog@2`).
 * - `body` is the full {@link import("@repo/model").Catalog} as JSONB, typed
 *   precisely at the apps/api boundary (db stays decoupled from @repo/model);
 *   its shape is gated on write by the catalog structural check.
 */
import { integer, jsonb, pgTable, uniqueIndex } from "drizzle-orm/pg-core";

import { id, timestamps } from "../../columns.js";

export const catalogVersion = pgTable(
  "catalog_version",
  {
    id: id(),
    /** `Catalog.version` — the number quote stamps reference (I3). */
    version: integer("version").notNull(),
    /** Full `Catalog` payload (JSONB); typed at the apps/api edge. */
    body: jsonb("body").notNull(),
    ...timestamps(),
  },
  (table) => [
    // Immutable append-only store: a catalog version is globally unique (I3 —
    // there is never a second row for one version).
    uniqueIndex("catalog_version_version_uq").on(table.version),
  ],
);

export type CatalogVersionRow = typeof catalogVersion.$inferSelect;
export type NewCatalogVersionRow = typeof catalogVersion.$inferInsert;
