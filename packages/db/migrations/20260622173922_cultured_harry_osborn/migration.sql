SET lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;