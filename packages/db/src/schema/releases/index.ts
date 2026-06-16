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
import { organization } from "../auth/index.js";

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
    /** The vendor's canonical example config (a valid `ConfigInput`) — the
     *  configurator's starting point, gated at publish via `gateInput`. Publish
     *  METADATA (like `catalogVersion`), NOT part of the immutable derivation
     *  body / I3 stamp; nullable (a release may ship no UI example). Typed at
     *  the apps/api edge (kept dep-free here, like `body`). */
    initialInput: jsonb("initial_input"),
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

/**
 * Per-tenant release ASSIGNMENT (CORE_SPEC §3, ADR 0062) — which immutable
 * releases an organization may SEE/configure. The vendor (platform operator)
 * assigns; a tenant's release LIST filters through this join, so an org sees
 * only its assigned releases (closing the interim "all published visible to
 * every org" leak). DISCOVERY metadata, NOT I3 data:
 *
 *  - `releaseId` is the natural key ("modelId@version"), deliberately NOT a DB
 *    FK to `release`: the release store is append-only (the key never vanishes)
 *    and the assign service validates existence + published on write, so a soft
 *    reference is sound — and it keeps assignments DISPOSABLE. A quote stamped
 *    on a release re-derives forever via the GLOBAL `findByReleaseId` whether or
 *    not the assignment still exists (I3 ≠ visibility — the asymmetry is the point).
 *  - `organizationId` CASCADEs (unlike the I3 stores' RESTRICT): dropping an org
 *    drops its disposable assignments, never any durable data.
 *  - unique `(organizationId, releaseId)`: assignment is idempotent set-membership.
 *  - `assignedBy` is the platform operator's user id — a soft audit ref (like
 *    `audit.actorId`), no FK.
 */
export const orgReleaseAssignment = pgTable(
  "org_release_assignment",
  {
    id: id(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** Natural release key ("modelId@version") — soft reference (see above). */
    releaseId: text("release_id").notNull(),
    /** Platform operator who made the assignment (soft audit ref). */
    assignedBy: text("assigned_by").notNull(),
    ...timestamps(),
  },
  (t) => [
    // Idempotent set-membership: one row per (org, release).
    uniqueIndex("org_release_assignment_org_release_uq").on(t.organizationId, t.releaseId),
    // Reverse lookup — which orgs see a given release (the platform view).
    index("org_release_assignment_release_idx").on(t.releaseId),
  ],
);

export type OrgReleaseAssignmentRow = typeof orgReleaseAssignment.$inferSelect;
export type NewOrgReleaseAssignmentRow = typeof orgReleaseAssignment.$inferInsert;
