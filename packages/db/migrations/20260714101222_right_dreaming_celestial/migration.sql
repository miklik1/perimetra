-- Deviation / exception ledger (ADR 0110 / ADR-O4, CAR-159). Pure EXPAND
-- (ADR 0038): one brand-new empty table + indexes + FKs, N−1 safe. A REBUILDABLE
-- write-through projection (org FK CASCADEs; rows disposable), NOT a legal
-- record — deliberately weaker durability than quotes/invoices.
SET lock_timeout = '5s';

CREATE TABLE "deviation_ledger" (
	"id" uuid PRIMARY KEY,
	"organization_id" text NOT NULL,
	"quote_id" uuid NOT NULL,
	"order_id" uuid,
	"source" text NOT NULL,
	"kind" text,
	"target" text,
	"value" jsonb,
	"reason" text DEFAULT '' NOT NULL,
	"actor_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "deviation_ledger_org_target_idx" ON "deviation_ledger" ("organization_id","target");--> statement-breakpoint
CREATE INDEX "deviation_ledger_org_quote_idx" ON "deviation_ledger" ("organization_id","quote_id");--> statement-breakpoint
ALTER TABLE "deviation_ledger" ADD CONSTRAINT "deviation_ledger_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "deviation_ledger" ADD CONSTRAINT "deviation_ledger_quote_id_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "quote"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "deviation_ledger" ADD CONSTRAINT "deviation_ledger_order_id_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "order"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "deviation_ledger" ADD CONSTRAINT "deviation_ledger_actor_id_user_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "user"("id") ON DELETE SET NULL;