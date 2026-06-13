SET lock_timeout = '5s';--> statement-breakpoint
-- ADR 0053 step 6.3b: per-tenant versioned, append-only price tables with
-- effective-date windows. Expand-only (new table, N-1 compatible). Owner-scoped
-- now (ADR-0041 seam); the org retrofit flips scope with every other module.
CREATE TABLE "price_table" (
	"id" uuid PRIMARY KEY,
	"owner_id" text NOT NULL,
	"organization_id" text,
	"version" integer NOT NULL,
	"currency" text NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"margin_floor_pct" numeric,
	"dph_rate" numeric NOT NULL,
	"reverse_charge" boolean DEFAULT false NOT NULL,
	"table" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "price_table_owner_version_uq" ON "price_table" ("owner_id","version");--> statement-breakpoint
CREATE INDEX "price_table_owner_effective_idx" ON "price_table" ("owner_id","effective_from");--> statement-breakpoint
ALTER TABLE "price_table" ADD CONSTRAINT "price_table_owner_id_user_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "price_table" ADD CONSTRAINT "price_table_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE SET NULL;