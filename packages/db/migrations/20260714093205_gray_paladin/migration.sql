-- Order domain + shared document-number allocator (ADR 0109 / ADR-O1, CAR-156).
-- Pure EXPAND (ADR 0038): two brand-new, empty tables + their indexes and FKs —
-- no column drops, no rewrites, N−1 compatible (old code ignores the new tables).
-- `order` is the thin reference over an accepted quote (RESTRICT FKs for I3
-- durability; the partial-unique enforces one live order per quote).
-- `document_number_sequence` generalizes the ADR 0079 counter (the quote counter
-- migrates in at ADR-O2/CAR-157). FK validation is instant on empty tables; the
-- lock_timeout is the standing guard.
SET lock_timeout = '5s';

CREATE TABLE "order" (
	"id" uuid PRIMARY KEY,
	"owner_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"quote_id" uuid NOT NULL,
	"order_number" text NOT NULL,
	"status" text NOT NULL,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_number_sequence" (
	"organization_id" text,
	"series" text,
	"year" integer,
	"last_number" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_number_sequence_pkey" PRIMARY KEY("organization_id","series","year")
);
--> statement-breakpoint
CREATE INDEX "order_org_id_id_idx" ON "order" ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "order_org_number_uq" ON "order" ("organization_id","order_number");--> statement-breakpoint
CREATE UNIQUE INDEX "order_quote_active_uq" ON "order" ("quote_id") WHERE "status" <> 'cancelled';--> statement-breakpoint
ALTER TABLE "order" ADD CONSTRAINT "order_owner_id_user_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "user"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "order" ADD CONSTRAINT "order_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "order" ADD CONSTRAINT "order_quote_id_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "quote"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "document_number_sequence" ADD CONSTRAINT "document_number_sequence_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;