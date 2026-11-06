CREATE TABLE IF NOT EXISTS "rain_day_run" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"user_id" text,
	"status" text DEFAULT 'done' NOT NULL,
	"from_date" text NOT NULL,
	"to_date" text,
	"through_date" text,
	"shift_days" integer,
	"route_id" text,
	"moves" json NOT NULL,
	"text_ids" json,
	"moved" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp,
	"undone_at" timestamp,
	"undone_by_id" text
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rain_day_run" ADD CONSTRAINT "rain_day_run_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rain_day_run" ADD CONSTRAINT "rain_day_run_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rain_day_run" ADD CONSTRAINT "rain_day_run_undone_by_id_user_id_fk" FOREIGN KEY ("undone_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rain_day_run_company_id_idx" ON "rain_day_run" USING btree ("company_id");