CREATE TABLE "customer" (
	"id" uuid PRIMARY KEY,
	"organization_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"ico" text,
	"dic" text,
	"vat_payer" boolean DEFAULT false NOT NULL,
	"email" text,
	"phone" text,
	"address_line" text,
	"city" text,
	"postal_code" text,
	"country" text DEFAULT 'CZ' NOT NULL,
	"note" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "customer_id" uuid;--> statement-breakpoint
CREATE INDEX "customer_org_owner_id_idx" ON "customer" ("organization_id","owner_id","id") WHERE "deleted_at" IS NULL;--> statement-breakpoint
ALTER TABLE "quote" ADD CONSTRAINT "quote_customer_id_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "customer" ADD CONSTRAINT "customer_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "customer" ADD CONSTRAINT "customer_owner_id_user_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "user"("id") ON DELETE RESTRICT;