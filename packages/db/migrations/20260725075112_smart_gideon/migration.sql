-- A2 (ADR 0129): `document_delivery` — the record of an outward act (a rep sent
-- a quote or an invoice to its buyer by e-mail). PURE EXPAND: one new table, no
-- column added to an existing table, no backfill — therefore trivially N-1 safe
-- (no existing row is touched and no running code reads it). RESTRICT FKs on
-- owner/organization/customer: the evidence of an outward commercial act must
-- survive user/tenant deletion, and GDPR erasure anonymizes rather than cascades
-- (ADR 0071). `document_id` deliberately carries NO FK — it is polymorphic over
-- quote.id | invoice.id, i.e. two other modules' schemas (ADR 0032); a soft
-- natural-key ref, the org_release_assignment posture. The partial unique index
-- is scoped to status='queued' ONLY so a worker that crashed mid-send can never
-- block that document's re-send. `recipient_email` is pii()-registered
-- (ADR 0040). No lock beyond the new table's own creation; lock_timeout is set
-- per the ADR-0038 doctrine regardless.
SET lock_timeout = '5s';--> statement-breakpoint
CREATE TABLE "document_delivery" (
	"id" uuid PRIMARY KEY,
	"owner_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"document_type" text NOT NULL,
	"document_id" uuid NOT NULL,
	"document_number" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"recipient_email" text NOT NULL,
	"locale" text,
	"link_path" text,
	"amount_money" text,
	"currency" text,
	"variable_symbol" text,
	"due_on" date,
	"pay_to_iban" text,
	"status" text NOT NULL,
	"sent_at" timestamp with time zone,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "document_delivery_org_doc_id_idx" ON "document_delivery" ("organization_id","document_type","document_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_delivery_inflight_uq" ON "document_delivery" ("document_type","document_id") WHERE "status" = 'queued';--> statement-breakpoint
ALTER TABLE "document_delivery" ADD CONSTRAINT "document_delivery_owner_id_user_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "user"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "document_delivery" ADD CONSTRAINT "document_delivery_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "document_delivery" ADD CONSTRAINT "document_delivery_customer_id_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer"("id") ON DELETE RESTRICT;