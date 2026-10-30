CREATE TABLE IF NOT EXISTS "snow_storm" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"ended_at" timestamp,
	"notes" text,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "snow_storm_stop" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"storm_id" text NOT NULL,
	"snow_contract_id" text NOT NULL,
	"site_id" text NOT NULL,
	"job_id" text,
	"event_id" text,
	"assigned_to_id" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"started_at" timestamp,
	"done_at" timestamp,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "snow_contract" ADD COLUMN "hourly_rate" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "snow_event" ADD COLUMN "hours" numeric(5, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "snow_event" ADD COLUMN "storm_id" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "snow_storm" ADD CONSTRAINT "snow_storm_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "snow_storm" ADD CONSTRAINT "snow_storm_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "snow_storm_stop" ADD CONSTRAINT "snow_storm_stop_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "snow_storm_stop" ADD CONSTRAINT "snow_storm_stop_storm_id_snow_storm_id_fk" FOREIGN KEY ("storm_id") REFERENCES "public"."snow_storm"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "snow_storm_stop" ADD CONSTRAINT "snow_storm_stop_snow_contract_id_snow_contract_id_fk" FOREIGN KEY ("snow_contract_id") REFERENCES "public"."snow_contract"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "snow_storm_stop" ADD CONSTRAINT "snow_storm_stop_site_id_site_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."site"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "snow_storm_stop" ADD CONSTRAINT "snow_storm_stop_job_id_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "snow_storm_stop" ADD CONSTRAINT "snow_storm_stop_event_id_snow_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."snow_event"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "snow_storm_stop" ADD CONSTRAINT "snow_storm_stop_assigned_to_id_user_id_fk" FOREIGN KEY ("assigned_to_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "snow_storm_company_id_idx" ON "snow_storm" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "snow_storm_stop_contract_idx" ON "snow_storm_stop" USING btree ("storm_id","snow_contract_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "snow_storm_stop_company_id_idx" ON "snow_storm_stop" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "snow_storm_stop_job_id_idx" ON "snow_storm_stop" USING btree ("job_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "snow_event" ADD CONSTRAINT "snow_event_storm_id_snow_storm_id_fk" FOREIGN KEY ("storm_id") REFERENCES "public"."snow_storm"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
