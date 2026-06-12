/**
 * Append-only audit log (spec §7.7, ADR 0040 — GDPR Art. 30 + security
 * questionnaires). Rows are written by `AuditService.record()` and ONLY ever
 * inserted — no code path updates or deletes individual rows; the sole
 * deletion is the scheduled 2-year retention sweep (privacy queue,
 * `audit-cleanup` job).
 *
 * - `id` is UUIDv7 → time-ordered, so it doubles as the retention sweep's
 *   range key (delete `WHERE id < boundary(cutoff)` rides the PK index) and
 *   the tiebreaker in both composite indexes.
 * - `actorId` is nullable: system/worker actions (e.g. the privacy erasure
 *   job itself) have no acting user.
 * - `diff` carries the before/after payload; writers must keep PII out of it
 *   for erased fields (IDs and non-PII fields only is the safe default).
 * - No `timestamps()`/`softDelete()` helpers: append-only rows are never
 *   updated or soft-deleted, so only `created_at` exists (deliberate,
 *   documented exception to ADR 0032's helper rule).
 */
import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { id } from "../../columns.js";

export const audit = pgTable(
  "audit",
  {
    id: id(),
    /** Acting user id; NULL for system/worker-initiated actions. */
    actorId: text("actor_id"),
    /** Verb, dot-namespaced: "project.create", "privacy.erase", … */
    action: text("action").notNull(),
    /** Entity kind, e.g. "project", "user". */
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    /** Before/after diff — IDs and non-PII fields only. */
    diff: jsonb("diff").$type<Record<string, unknown>>(),
    /** Pino request id (CLS-propagated) — correlates audit rows with logs. */
    requestId: text("request_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // "History of this entity": WHERE entity_type/entity_id, ORDER BY id.
    index("audit_entity_type_entity_id_id_idx").on(table.entityType, table.entityId, table.id),
    // "Everything this actor did": WHERE actor_id, ORDER BY id.
    index("audit_actor_id_id_idx").on(table.actorId, table.id),
  ],
);
