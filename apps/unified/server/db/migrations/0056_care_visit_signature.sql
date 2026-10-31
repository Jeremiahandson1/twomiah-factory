CREATE TABLE IF NOT EXISTS "visit_signature" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"time_entry_id" text NOT NULL,
	"client_id" text NOT NULL,
	"signature_image" text,
	"signed_at" timestamp,
	"reason_code" text,
	"reason_note" text,
	"recorded_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "schedules" ADD COLUMN "repeat_group_id" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "visit_signature" ADD CONSTRAINT "visit_signature_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "visit_signature" ADD CONSTRAINT "visit_signature_time_entry_id_time_entries_id_fk" FOREIGN KEY ("time_entry_id") REFERENCES "public"."time_entries"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "visit_signature" ADD CONSTRAINT "visit_signature_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "visit_signature" ADD CONSTRAINT "visit_signature_recorded_by_id_user_id_fk" FOREIGN KEY ("recorded_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "visit_signature_visit_idx" ON "visit_signature" USING btree ("time_entry_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "visit_signature_company_idx" ON "visit_signature" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "schedules_repeat_group_idx" ON "schedules" USING btree ("repeat_group_id");