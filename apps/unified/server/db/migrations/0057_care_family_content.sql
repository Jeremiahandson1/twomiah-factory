CREATE TABLE IF NOT EXISTS "visit_meal" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"time_entry_id" text NOT NULL,
	"client_id" text NOT NULL,
	"meal" text NOT NULL,
	"description" text,
	"amount_eaten" text NOT NULL,
	"note" text,
	"recorded_by_id" text,
	"served_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "share_with_family" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "family_members" ADD COLUMN "can_view_vitals" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "family_members" ADD COLUMN "can_view_documents" boolean DEFAULT false NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "visit_meal" ADD CONSTRAINT "visit_meal_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "visit_meal" ADD CONSTRAINT "visit_meal_time_entry_id_time_entries_id_fk" FOREIGN KEY ("time_entry_id") REFERENCES "public"."time_entries"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "visit_meal" ADD CONSTRAINT "visit_meal_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "visit_meal" ADD CONSTRAINT "visit_meal_recorded_by_id_user_id_fk" FOREIGN KEY ("recorded_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "visit_meal_visit_idx" ON "visit_meal" USING btree ("time_entry_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "visit_meal_client_idx" ON "visit_meal" USING btree ("client_id","served_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "visit_meal_once_idx" ON "visit_meal" USING btree ("time_entry_id","meal");
--> statement-breakpoint
-- Vitals followed the medicines switch until now: keep every relative seeing exactly what they saw, so turning the new switch on changes nothing by itself.
UPDATE "family_members" SET "can_view_vitals" = "can_view_medications";
