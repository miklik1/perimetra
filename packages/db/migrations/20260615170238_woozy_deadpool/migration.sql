SET lock_timeout = '5s';--> statement-breakpoint
-- ADR 0059 (cost-model slice): co-locate cost-of-goods on the price_table row so
-- the existing `version` stamps it for I3 (no separate cost version/table).
-- Expand-only — nullable column, N-1 compatible; old rows have no cost yet.
ALTER TABLE "price_table" ADD COLUMN "cost" jsonb;
