SET lock_timeout = '5s';--> statement-breakpoint
-- Per-release catalog (ADR 0065): a quote now derives each release against its
-- OWN catalog version, so a quote spans a MAP of releaseId→version with no
-- single-column form. The scalar `catalog_version` denorm is therefore dropped —
-- the authoritative copy already lives in `stamps.catalogVersions` (JSONB), so
-- this loses no data. DROP COLUMN is metadata-only (no table rewrite); the
-- price-table version stays a scalar denorm (one price table per site).
ALTER TABLE "quote" DROP COLUMN "catalog_version";
