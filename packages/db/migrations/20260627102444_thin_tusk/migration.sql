CREATE TABLE "legal_profile" (
	"id" uuid PRIMARY KEY,
	"organization_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"ico" text,
	"dic" text,
	"vat_payer" boolean DEFAULT false NOT NULL,
	"address_line" text,
	"city" text,
	"postal_code" text,
	"country" text DEFAULT 'CZ' NOT NULL,
	"bank_account" text,
	"registration_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "legal_profile_org_id_uidx" ON "legal_profile" ("organization_id");--> statement-breakpoint
ALTER TABLE "legal_profile" ADD CONSTRAINT "legal_profile_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "legal_profile" ADD CONSTRAINT "legal_profile_owner_id_user_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "user"("id") ON DELETE RESTRICT;