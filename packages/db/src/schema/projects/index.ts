/**
 * Reference resource schema (spec §7.8) — the table every future domain
 * module copies. Conventions on display:
 *
 * - `id()` UUIDv7: time-ordered, so it doubles as the keyset-pagination
 *   cursor (no separate `created_at` cursor column needed).
 * - `ownerId` is the interim ownership scope (ADR 0041): every query in
 *   `projects.repository.ts` filters on it via the RequestScope seam.
 * - `organizationId` is the DORMANT tenancy seam: nullable FK now, flipped
 *   to `NOT NULL` + scope filter when multi-tenancy is retrofitted — a
 *   migration + one repository change, not a project-wide hunt.
 * - `softDelete()`: rows are never hard-deleted by the API; the partial
 *   index keeps the hot list query (live rows per owner) tight.
 */
import { sql } from "drizzle-orm";
import { index, pgTable, text } from "drizzle-orm/pg-core";

import { id, softDelete, timestamps } from "../../columns.js";
import { organization, user } from "../auth/index.js";

export const PROJECT_STATUSES = ["active", "archived"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const project = pgTable(
  "project",
  {
    id: id(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Dormant tenancy seam (ADR 0041) — populated, never filtered on (yet). */
    organizationId: text("organization_id").references(() => organization.id, {
      onDelete: "set null",
    }),
    /** Length bounds (1–200) live in the zod contract (`@repo/validators/projects`). */
    name: text("name").notNull(),
    /** Max 2000 chars — zod-enforced. */
    description: text("description"),
    status: text("status").notNull().default("active").$type<ProjectStatus>(),
    ...timestamps(),
    ...softDelete(),
  },
  (table) => [
    // THE list query: WHERE owner_id = ? AND deleted_at IS NULL ORDER BY id.
    // Partial — soft-deleted rows leave the index instead of bloating it.
    index("project_owner_id_id_idx")
      .on(table.ownerId, table.id)
      .where(sql`${table.deletedAt} IS NULL`),
  ],
);

export type ProjectRow = typeof project.$inferSelect;
export type NewProjectRow = typeof project.$inferInsert;
