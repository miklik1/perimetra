CREATE TABLE "project_instance" (
	"id" uuid PRIMARY KEY,
	"project_id" uuid NOT NULL,
	"instance_id" text NOT NULL,
	"release_id" text NOT NULL,
	"input" jsonb NOT NULL,
	"overrides" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "site" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "project_instance_project_id_instance_id_uq" ON "project_instance" ("project_id","instance_id");--> statement-breakpoint
ALTER TABLE "project_instance" ADD CONSTRAINT "project_instance_project_id_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE;