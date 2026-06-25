SET lock_timeout = '5s';--> statement-breakpoint
-- ADR 0079 (gap-free numbering series). Per-org/year quote document-number
-- counter — operational state, org FK CASCADE (the immutable quote rows carry
-- I3 durability via RESTRICT, the counter need not).
CREATE TABLE "quote_number_sequence" (
	"organization_id" text,
	"year" integer,
	"last_number" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quote_number_sequence_pkey" PRIMARY KEY("organization_id","year")
);
--> statement-breakpoint
ALTER TABLE "quote_number_sequence" ADD CONSTRAINT "quote_number_sequence_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
-- The document number is NOT NULL on the schema, but add it backfill-safe so the
-- migration is N-1 / non-empty-table safe: add nullable, backfill any pre-ADR-0079
-- rows with a clearly-marked legacy number (id is unique → the unique index holds),
-- then enforce NOT NULL. New quotes get a real `{year}/{seq:04d}` number at issue.
ALTER TABLE "quote" ADD COLUMN "document_number" text;--> statement-breakpoint
UPDATE "quote" SET "document_number" = 'LEGACY/' || "id" WHERE "document_number" IS NULL;--> statement-breakpoint
ALTER TABLE "quote" ALTER COLUMN "document_number" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "quote_org_document_number_uq" ON "quote" ("organization_id","document_number");
