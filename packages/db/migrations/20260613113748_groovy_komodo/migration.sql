SET lock_timeout = '5s';--> statement-breakpoint
-- ADR 0053 step 6.3d: the frozen commercial artifact. stamps (SiteStamps) +
-- snapshot (frozen outputs + re-derivation seed) make a quote re-derivable
-- forever (I3). Expand-only (new table, N-1 compatible). Owner-scoped now
-- (ADR-0041 seam); projectId nullable until project persistence lands.
CREATE TABLE "quote" (
	"id" uuid PRIMARY KEY,
	"owner_id" text NOT NULL,
	"organization_id" text,
	"project_id" uuid,
	"status" text NOT NULL,
	"currency" text NOT NULL,
	"share_token" text NOT NULL,
	"valid_until" timestamp with time zone,
	"total_money" text NOT NULL,
	"catalog_version" integer NOT NULL,
	"price_table_version" integer NOT NULL,
	"stamps" jsonb NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "quote_owner_id_id_idx" ON "quote" ("owner_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "quote_share_token_uq" ON "quote" ("share_token");--> statement-breakpoint
ALTER TABLE "quote" ADD CONSTRAINT "quote_owner_id_user_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "quote" ADD CONSTRAINT "quote_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "quote" ADD CONSTRAINT "quote_project_id_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE SET NULL;