/**
 * Transactional outbox (ADR 0037, spec §5): domain events are written here in
 * the SAME transaction as the state change; the worker's relay publishes them
 * to BullMQ and marks them. Payloads carry IDs, never PII (spec §7.2 rule —
 * this is what keeps Redis non-PII-bearing and rebuildable).
 *
 * - `id` is UUIDv7 → time-ordered, doubles as the relay's FIFO sort key and
 *   the BullMQ `jobId` (consumer dedup).
 * - `status`: pending → published | dead (enqueue kept failing; poison row).
 * - `traceparent` carries W3C trace context request → job (ADR 0036).
 */
import { index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { id } from "../../columns.js";

export const OUTBOX_STATUSES = ["pending", "published", "dead"] as const;
export type OutboxStatus = (typeof OUTBOX_STATUSES)[number];

export const outbox = pgTable(
  "outbox",
  {
    id: id(),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: text("aggregate_id").notNull(),
    eventType: text("event_type").notNull(),
    /** IDs-only event payload — processors re-fetch state, never trust this. */
    payload: jsonb("payload").notNull().$type<Record<string, unknown>>(),
    traceparent: text("traceparent"),
    status: text("status").notNull().default("pending").$type<OutboxStatus>(),
    attempts: integer("attempts").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
  },
  (table) => [
    // The relay's claim query: WHERE status = 'pending' ORDER BY id.
    index("outbox_status_id_idx").on(table.status, table.id),
    // The cleanup job's range scan: published rows older than the retention.
    index("outbox_published_at_idx").on(table.publishedAt),
  ],
);
