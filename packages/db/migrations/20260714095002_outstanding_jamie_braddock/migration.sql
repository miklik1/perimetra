-- Quote revision / supersession chains (ADR 0109 / ADR-O1, CAR-158). Pure EXPAND
-- (ADR 0038): two NULLABLE self-referencing columns + a unique index + two FKs.
-- N−1 safe — old code ignores the new columns; every existing quote has them
-- NULL, so the unique index builds instantly and the FK validation is trivial
-- (NULLs skip the check). `superseded_by_id` UNIQUE keeps chains linear; nullable,
-- so the many live heads (NULL) coexist (Postgres treats NULLs as distinct).
SET lock_timeout = '5s';

ALTER TABLE "quote" ADD COLUMN "revision_of_id" uuid;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "superseded_by_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "quote_superseded_by_id_uq" ON "quote" ("superseded_by_id");--> statement-breakpoint
ALTER TABLE "quote" ADD CONSTRAINT "quote_revision_of_id_quote_id_fkey" FOREIGN KEY ("revision_of_id") REFERENCES "quote"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "quote" ADD CONSTRAINT "quote_superseded_by_id_quote_id_fkey" FOREIGN KEY ("superseded_by_id") REFERENCES "quote"("id");