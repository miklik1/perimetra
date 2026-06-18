SET lock_timeout = '5s';--> statement-breakpoint
CREATE TABLE "org_model_pin" (
	"id" uuid PRIMARY KEY,
	"organization_id" text NOT NULL,
	"model_id" text NOT NULL,
	"pinned_release_id" text NOT NULL,
	"pinned_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "org_model_pin_org_model_uq" ON "org_model_pin" ("organization_id","model_id");--> statement-breakpoint
CREATE INDEX "release_model_version_idx" ON "release" ("model_id","version");--> statement-breakpoint
ALTER TABLE "org_model_pin" ADD CONSTRAINT "org_model_pin_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
-- Backfill (ADR 0064): pin each (org, model) an org is already assigned to its
-- HIGHEST assigned version, so the configurator keeps offering the version it
-- offered before this slice. An explicit-opt-in record for pre-existing
-- assignments; idempotent via the unique index (a re-run is a no-op). `version`
-- is unique within a model ("modelId@version"), so MAX maps to exactly one row.
INSERT INTO "org_model_pin" ("id", "organization_id", "model_id", "pinned_release_id", "pinned_by")
SELECT gen_random_uuid(), a."organization_id", r."model_id", r."release_id", 'system-backfill'
FROM "org_release_assignment" a
JOIN "release" r ON r."release_id" = a."release_id"
JOIN (
	SELECT a2."organization_id" AS org, r2."model_id" AS model_id, MAX(r2."version") AS maxver
	FROM "org_release_assignment" a2
	JOIN "release" r2 ON r2."release_id" = a2."release_id"
	GROUP BY a2."organization_id", r2."model_id"
) m ON m.org = a."organization_id" AND m.model_id = r."model_id" AND m.maxver = r."version"
ON CONFLICT ("organization_id", "model_id") DO NOTHING;