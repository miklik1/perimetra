/**
 * Release store (CORE_SPEC §3, I3) — immutable, global, vendor-authored
 * `ProductModelRelease`s. Like the catalog-version store (and unlike the
 * reference resource `schema/projects`) this is NOT owner/tenant-scoped and NOT
 * soft-deletable: a published release is global data, append-only, never
 * mutated or deleted — a quote stamped against `releaseId` must re-derive
 * forever (I3). Writes are admin-gated at the app layer (RoleGuard lands with
 * the roles slice); tenant-visibility (release assignment) is a later slice.
 *
 * - `id()` UUIDv7 surrogate: the keyset-pagination cursor.
 * - `releaseId` is the natural key (`ProductModelRelease.id` = "modelId@version")
 *   — the exact handle quote stamps record (`SiteStamps.releaseIds`, I3). The
 *   unique index makes re-publishing a version structurally impossible.
 * - `catalogVersion` pins which catalog the release validates/derives against.
 * - `body` is the full `ProductModelRelease` as JSONB, typed at the apps/api
 *   boundary; its shape is gated on write by `validateRelease` (@repo/model).
 */
import { index, integer, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";

import { id, timestamps } from "../../columns.js";

/** Mirrors `ReleaseStatus` in @repo/model (draft authoring is vendor-internal;
 *  the store only ever holds published/retired rows in this slice). */
export const RELEASE_STATUSES = ["draft", "published", "retired"] as const;
export type ReleaseStatus = (typeof RELEASE_STATUSES)[number];

export const release = pgTable(
  "release",
  {
    id: id(),
    /** `ProductModelRelease.id` = "modelId@version" — the quote-stamp handle (I3). */
    releaseId: text("release_id").notNull(),
    modelId: text("model_id").notNull(),
    version: integer("version").notNull(),
    /** The catalog version this release validates + derives against. */
    catalogVersion: integer("catalog_version").notNull(),
    status: text("status").notNull().$type<ReleaseStatus>(),
    /** Full `ProductModelRelease` payload (JSONB); typed at the apps/api edge. */
    body: jsonb("body").notNull(),
    ...timestamps(),
  },
  (table) => [
    // Immutable append-only store: one row per "modelId@version" (I3).
    uniqueIndex("release_release_id_uq").on(table.releaseId),
    // List query: by status (e.g. published), newest first (keyset by id).
    index("release_status_id_idx").on(table.status, table.id),
  ],
);

export type ReleaseRow = typeof release.$inferSelect;
export type NewReleaseRow = typeof release.$inferInsert;
