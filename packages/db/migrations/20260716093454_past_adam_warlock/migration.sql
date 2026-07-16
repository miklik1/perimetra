-- O2-b (ADR 0112, ADR-O2): the invoice — the second frozen document class. A new
-- `invoice` table (immutable §29 daňový doklad: frozen `facts` + `snapshot` JSONB,
-- RESTRICT FKs for I3 durability) + the `legal_profile.iban` payment column that
-- invoice issue gates on (§5). Pure EXPAND (a new table + a nullable column) —
-- N-1 safe: no existing row is touched and no running code reads either yet, so
-- old and new pods coexist cleanly. lock_timeout bounds the brief ACCESS
-- EXCLUSIVE on the altered `legal_profile` (ADR 0038).
SET lock_timeout = '5s';--> statement-breakpoint
CREATE TABLE "invoice" (
	"id" uuid PRIMARY KEY,
	"owner_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"order_id" uuid NOT NULL,
	"document_number" text NOT NULL,
	"status" text NOT NULL,
	"superseded_by_id" uuid,
	"currency" text NOT NULL,
	"issued_on" date NOT NULL,
	"duzp" date NOT NULL,
	"due_on" date NOT NULL,
	"variable_symbol" text NOT NULL,
	"total_money" text NOT NULL,
	"facts" jsonb NOT NULL,
	"snapshot" jsonb NOT NULL,
	"paid_at" timestamp with time zone,
	"paid_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "legal_profile" ADD COLUMN "iban" text;--> statement-breakpoint
CREATE INDEX "invoice_org_id_id_idx" ON "invoice" ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_org_document_number_uq" ON "invoice" ("organization_id","document_number");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_order_active_uq" ON "invoice" ("order_id") WHERE "superseded_by_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_superseded_by_id_uq" ON "invoice" ("superseded_by_id");--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_owner_id_user_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "user"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_order_id_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "order"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_superseded_by_id_invoice_id_fkey" FOREIGN KEY ("superseded_by_id") REFERENCES "invoice"("id");