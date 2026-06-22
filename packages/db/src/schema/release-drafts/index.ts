/**
 * ReleaseDraft schema (ADR 0068 Phase 3) — a MUTABLE, org-scoped author
 * workspace for building a Product Model Release before the immutable publish
 * freeze (I3). Wholly separate from the `release` store: a draft is editable,
 * never re-derivable, and never touched by the quote-reproduction path. The
 * publish path stays the existing immutable `POST /v1/releases` (no second
 * freeze path) — this table only holds in-progress editor state.
 *
 * - `id()` UUIDv7: time-ordered, so it doubles as the keyset-pagination cursor.
 * - `organizationId` is THE access scope (ADR 0055) — NOT NULL, every query
 *   filters on it, so a vendor TEAM shares its org's drafts. `ownerId` is the
 *   creator/audit ref; CASCADE on both (mutable working state, unlike the
 *   RESTRICT immutable I3 stores quote/price_table).
 * - `body` is the editor's form state (the web `ReleaseDraftInput`) as opaque
 *   JSONB. Drafts are legitimately incomplete/invalid (that's the point), so it
 *   is NEVER shape-validated at the DB boundary — the publish gate is the only
 *   authority (matches the project `site` / quote `snapshot` stance).
 * - `modelId` / `version` / `catalogVersion` / `baseReleaseId` are denormalized
 *   projections off `body` for the draft list + clone/diff (Phase 3C/3D), never
 *   the source of truth.
 * - `softDelete()`: rows are tombstoned; the partial index keeps the hot
 *   per-org list query tight.
 */
import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, text } from "drizzle-orm/pg-core";

import { id, softDelete, timestamps } from "../../columns.js";
import { organization, user } from "../auth/index.js";

export const releaseDraft = pgTable(
  "release_draft",
  {
    id: id(),
    /** Creator/audit ref (ADR 0055) — no longer the access scope. CASCADE: a
     *  draft is mutable working state, unlike the RESTRICT I3 stores. */
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** THE access scope (ADR 0055) — NOT NULL, filtered on; a vendor team
     *  shares its org's drafts. */
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** Denorm off `body` for the list/grouping ("sliding-gate"); "" until set. */
    modelId: text("model_id").notNull().default(""),
    /** Denorm target version — the publish will freeze "modelId@version". */
    version: integer("version").notNull().default(1),
    /** Denorm picked catalog version; NULL until the author selects one. */
    catalogVersion: integer("catalog_version"),
    /** Provenance for the diff (Phase 3D): the published "modelId@version" this
     *  draft was cloned from; NULL when authored from scratch. Soft ref. */
    baseReleaseId: text("base_release_id"),
    /** The editor form state (web `ReleaseDraftInput`) — opaque, never gate-validated. */
    body: jsonb("body").notNull(),
    ...timestamps(),
    ...softDelete(),
  },
  (table) => [
    // THE list query: WHERE organization_id = ? AND deleted_at IS NULL ORDER BY id.
    // Partial — soft-deleted rows leave the index instead of bloating it.
    index("release_draft_org_id_id_idx")
      .on(table.organizationId, table.id)
      .where(sql`${table.deletedAt} IS NULL`),
  ],
);

export type ReleaseDraftRow = typeof releaseDraft.$inferSelect;
export type NewReleaseDraftRow = typeof releaseDraft.$inferInsert;
