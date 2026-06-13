SET lock_timeout = '5s';--> statement-breakpoint
-- ADR 0053 step 6.3a: immutable, global, append-only vendor stores (release +
-- catalog_version). Expand-only (new tables, N-1 compatible). Rows referenced
-- by an issued quote are never updated or deleted (I3) — enforced at the app
-- layer (no update/delete repository surface).
CREATE TABLE "release" (
	"id" uuid PRIMARY KEY,
	"release_id" text NOT NULL,
	"model_id" text NOT NULL,
	"version" integer NOT NULL,
	"catalog_version" integer NOT NULL,
	"status" text NOT NULL,
	"body" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog_version" (
	"id" uuid PRIMARY KEY,
	"version" integer NOT NULL,
	"body" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "release_release_id_uq" ON "release" ("release_id");--> statement-breakpoint
CREATE INDEX "release_status_id_idx" ON "release" ("status","id");--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_version_version_uq" ON "catalog_version" ("version");