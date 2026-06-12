SET lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE "outbox" (
	"id" uuid PRIMARY KEY,
	"aggregate_type" text NOT NULL,
	"aggregate_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"traceparent" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "outbox_status_id_idx" ON "outbox" ("status","id");--> statement-breakpoint
CREATE INDEX "outbox_published_at_idx" ON "outbox" ("published_at");