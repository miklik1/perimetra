CREATE TABLE "org_release_assignment" (
	"id" uuid PRIMARY KEY,
	"organization_id" text NOT NULL,
	"release_id" text NOT NULL,
	"assigned_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "org_release_assignment_org_release_uq" ON "org_release_assignment" ("organization_id","release_id");--> statement-breakpoint
CREATE INDEX "org_release_assignment_release_idx" ON "org_release_assignment" ("release_id");--> statement-breakpoint
ALTER TABLE "org_release_assignment" ADD CONSTRAINT "org_release_assignment_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;