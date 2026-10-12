CREATE TABLE IF NOT EXISTS "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text,
	"entity_name" text,
	"changes" jsonb,
	"metadata" jsonb,
	"user_id" text,
	"user_name" text,
	"user_email" text,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamptz DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_created_at_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_entity_entity_id_idx" ON "audit_log" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_user_id_idx" ON "audit_log" USING btree ("user_id");
