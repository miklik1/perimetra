/**
 * Shared column helpers — the single place the skeleton's data-lifecycle
 * conventions are encoded (ADR 0032). Every table uses these instead of
 * hand-rolling `id`/`created_at` variants:
 *
 * - `id()` — UUIDv7 primary key, generated app-side (PG 17 has no native
 *   uuidv7). Time-ordered, so it doubles as a keyset-pagination cursor and
 *   gives the outbox FIFO ordering for free.
 * - `timestamps()` — `created_at` / `updated_at` (timestamptz, UTC).
 *   `updated_at` is bumped app-side via `$onUpdate` (no trigger to migrate).
 * - `softDelete()` — nullable `deleted_at`. Unique constraints on
 *   soft-deletable tables must be partial (`WHERE deleted_at IS NULL`).
 *   Soft-deleted PII is still PII for erasure purposes (ADR 0040).
 */
import { timestamp, uuid } from "drizzle-orm/pg-core";
import { uuidv7 } from "uuidv7";

export const id = () =>
  uuid("id")
    .primaryKey()
    .$defaultFn(() => uuidv7());

export const timestamps = () => ({
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const softDelete = () => ({
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});
