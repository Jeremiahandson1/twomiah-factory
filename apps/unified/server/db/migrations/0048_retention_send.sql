CREATE TABLE IF NOT EXISTS "retention_send" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"kind" text NOT NULL,
	"event_key" text NOT NULL,
	"channel" text,
	"status" text NOT NULL,
	"reason" text,
	"message" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "retention_send" ADD CONSTRAINT "retention_send_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "retention_send" ADD CONSTRAINT "retention_send_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "retention_send_once" ON "retention_send" USING btree ("company_id","contact_id","kind","event_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "retention_send_company_created_idx" ON "retention_send" USING btree ("company_id","created_at");