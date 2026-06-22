SET lock_timeout = '5s';--> statement-breakpoint
CREATE TABLE "release_draft" (
	"id" uuid PRIMARY KEY,
	"owner_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"model_id" text DEFAULT '' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"catalog_version" integer,
	"base_release_id" text,
	"body" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "release_draft_org_id_id_idx" ON "release_draft" ("organization_id","id") WHERE "deleted_at" IS NULL;--> statement-breakpoint
ALTER TABLE "release_draft" ADD CONSTRAINT "release_draft_owner_id_user_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "release_draft" ADD CONSTRAINT "release_draft_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;