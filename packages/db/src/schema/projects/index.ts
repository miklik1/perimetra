/**
 * Reference resource schema (spec §7.8) — the table every future domain
 * module copies. Conventions on display:
 *
 * - `id()` UUIDv7: time-ordered, so it doubles as the keyset-pagination
 *   cursor (no separate `created_at` cursor column needed).
 * - `organizationId` is THE access scope (ADR 0041 seam, activated ADR 0055):
 *   NOT NULL, every query in `projects.repository.ts` filters on it.
 * - `ownerId` is retained as the creator/audit ref (who made the row); it is
 *   no longer the access boundary. `project` stays `onDelete: cascade` on the
 *   user (mutable user content, unlike the immutable I3 quote/price_table
 *   stores which are RESTRICT).
 * - `softDelete()`: rows are never hard-deleted by the API; the partial
 *   index keeps the hot list query (live rows per org) tight.
 */
import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { id, softDelete, timestamps } from "../../columns.js";
import { organization, user } from "../auth/index.js";

export const PROJECT_STATUSES = ["active", "archived"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const project = pgTable(
  "project",
  {
    id: id(),
    /** Creator/audit ref (ADR 0055) — no longer the access scope. */
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** THE access scope (ADR 0041 seam, activated ADR 0055) — NOT NULL, filtered on. */
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** Length bounds (1–200) live in the zod contract (`@repo/validators/projects`). */
    name: text("name").notNull(),
    /** Max 2000 chars — zod-enforced. */
    description: text("description"),
    status: text("status").notNull().default("active").$type<ProjectStatus>(),
    /**
     * The designed Site graph (terrain/placements/connections, step 6.3c) —
     * the project's one site, full-document replaced on save. NULL until a site
     * is designed. Opaque JSON: the engine is the validation gate (I5) and the
     * canvas legitimately persists invalid-but-editable sites, so this is never
     * shape-validated at the DB boundary (matches the quote `snapshot` stance).
     * The per-instance roster lives in `project_instance`, keyed by instanceId.
     */
    site: jsonb("site"),
    ...timestamps(),
    ...softDelete(),
  },
  (table) => [
    // THE list query: WHERE organization_id = ? AND deleted_at IS NULL ORDER BY id.
    // Partial — soft-deleted rows leave the index instead of bloating it.
    index("project_org_id_id_idx")
      .on(table.organizationId, table.id)
      .where(sql`${table.deletedAt} IS NULL`),
  ],
);

export type ProjectRow = typeof project.$inferSelect;
export type NewProjectRow = typeof project.$inferInsert;

/**
 * The project's instance roster (step 6.3c) — one row per placed instance on
 * the site canvas: which vendor release it pins, its raw config input, and any
 * cascade overrides. Keyed to the Site graph's placements by `instanceId`
 * (unique within a project). Child of `project` with ON DELETE CASCADE — the
 * roster has no independent lifetime, and is always read/written through the
 * owning project (so it carries no ownership scope of its own; the parent
 * project's `scoped()` filter is the access gate). Replaced wholesale on save.
 */
export const projectInstance = pgTable(
  "project_instance",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    /** Canvas-local instance id (e.g. "gate", "fence-run-2"). */
    instanceId: text("instance_id").notNull(),
    /** "modelId@version" — the immutable release pin (I3). */
    releaseId: text("release_id").notNull(),
    /** ConfigInput (raw per-instance values). */
    input: jsonb("input").notNull(),
    /** CascadeLayers — opaque overrides, NULL when none. */
    overrides: jsonb("overrides"),
    ...timestamps(),
  },
  (table) => [
    // One roster entry per instanceId within a project; also the lookup index
    // for loading a project's roster (WHERE project_id = ?).
    uniqueIndex("project_instance_project_id_instance_id_uq").on(table.projectId, table.instanceId),
  ],
);

export type ProjectInstanceRow = typeof projectInstance.$inferSelect;
export type NewProjectInstanceRow = typeof projectInstance.$inferInsert;
