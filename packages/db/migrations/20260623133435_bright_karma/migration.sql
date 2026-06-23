SET lock_timeout = '5s';--> statement-breakpoint
CREATE TABLE "twoFactor" (
	"id" text PRIMARY KEY,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"user_id" text NOT NULL,
	"verified" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "two_factor_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "twoFactor_userId_idx" ON "twoFactor" ("user_id");--> statement-breakpoint
ALTER TABLE "twoFactor" ADD CONSTRAINT "twoFactor_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;