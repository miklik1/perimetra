-- Org-scope activation (ADR 0055): backfill BEFORE constraining. For every
-- existing user that owns per-tenant rows, synthesize one organization + an
-- owner membership (deterministic ids so rows link without a CTE), then stamp
-- organization_id on the per-tenant tables. On a fresh DB these affect zero
-- rows; the SET NOT NULL below then holds. Idempotent via ON CONFLICT.
INSERT INTO "organization" ("id", "name", "slug")
SELECT 'org_' || u."id",
       COALESCE(NULLIF(u."name", ''), 'Workspace') || '''s workspace',
       'ws-' || u."id"
FROM "user" u
WHERE u."id" IN (
  SELECT "owner_id" FROM "project"
  UNION SELECT "owner_id" FROM "quote"
  UNION SELECT "owner_id" FROM "price_table"
)
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
INSERT INTO "member" ("id", "organization_id", "user_id", "role")
SELECT 'mem_' || u."id", 'org_' || u."id", u."id", 'owner'
FROM "user" u
WHERE u."id" IN (
  SELECT "owner_id" FROM "project"
  UNION SELECT "owner_id" FROM "quote"
  UNION SELECT "owner_id" FROM "price_table"
)
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
UPDATE "project" SET "organization_id" = 'org_' || "owner_id" WHERE "organization_id" IS NULL;--> statement-breakpoint
UPDATE "quote" SET "organization_id" = 'org_' || "owner_id" WHERE "organization_id" IS NULL;--> statement-breakpoint
UPDATE "price_table" SET "organization_id" = 'org_' || "owner_id" WHERE "organization_id" IS NULL;--> statement-breakpoint
DROP INDEX "project_owner_id_id_idx";--> statement-breakpoint
DROP INDEX "price_table_owner_version_uq";--> statement-breakpoint
DROP INDEX "price_table_owner_effective_idx";--> statement-breakpoint
DROP INDEX "quote_owner_id_id_idx";--> statement-breakpoint
ALTER TABLE "project" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "price_table" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "quote" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "project_org_id_id_idx" ON "project" ("organization_id","id") WHERE "deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "price_table_org_version_uq" ON "price_table" ("organization_id","version");--> statement-breakpoint
CREATE INDEX "price_table_org_effective_idx" ON "price_table" ("organization_id","effective_from");--> statement-breakpoint
CREATE INDEX "quote_org_id_id_idx" ON "quote" ("organization_id","id");--> statement-breakpoint
ALTER TABLE "project" DROP CONSTRAINT "project_organization_id_organization_id_fkey", ADD CONSTRAINT "project_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "price_table" DROP CONSTRAINT "price_table_owner_id_user_id_fkey", ADD CONSTRAINT "price_table_owner_id_user_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "user"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "price_table" DROP CONSTRAINT "price_table_organization_id_organization_id_fkey", ADD CONSTRAINT "price_table_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "quote" DROP CONSTRAINT "quote_owner_id_user_id_fkey", ADD CONSTRAINT "quote_owner_id_user_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "user"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "quote" DROP CONSTRAINT "quote_organization_id_organization_id_fkey", ADD CONSTRAINT "quote_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT;
