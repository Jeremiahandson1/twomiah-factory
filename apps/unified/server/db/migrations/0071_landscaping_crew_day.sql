CREATE TABLE IF NOT EXISTS "visit_crew_time" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"job_id" text NOT NULL,
	"user_id" text,
	"member_id" text,
	"started_at" timestamp NOT NULL,
	"ended_at" timestamp,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "visit_material" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"job_id" text NOT NULL,
	"user_id" text,
	"pricebook_item_id" text,
	"name" text NOT NULL,
	"quantity" numeric(10, 2) NOT NULL,
	"unit" text,
	"unit_cost_cents" integer,
	"entry_key" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "visit_skip" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"job_id" text NOT NULL,
	"user_id" text,
	"reason" text NOT NULL,
	"note" text,
	"rebook" boolean DEFAULT true NOT NULL,
	"skipped_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp,
	"resolved_by_id" text,
	"resolution" text,
	"rebooked_to" text
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "visit_crew_time" ADD CONSTRAINT "visit_crew_time_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "visit_crew_time" ADD CONSTRAINT "visit_crew_time_job_id_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "visit_crew_time" ADD CONSTRAINT "visit_crew_time_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "visit_crew_time" ADD CONSTRAINT "visit_crew_time_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "visit_material" ADD CONSTRAINT "visit_material_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "visit_material" ADD CONSTRAINT "visit_material_job_id_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "visit_material" ADD CONSTRAINT "visit_material_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "visit_skip" ADD CONSTRAINT "visit_skip_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "visit_skip" ADD CONSTRAINT "visit_skip_job_id_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "visit_skip" ADD CONSTRAINT "visit_skip_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "visit_skip" ADD CONSTRAINT "visit_skip_resolved_by_id_user_id_fk" FOREIGN KEY ("resolved_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "visit_crew_time_company_id_idx" ON "visit_crew_time" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "visit_crew_time_job_id_idx" ON "visit_crew_time" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "visit_material_company_id_idx" ON "visit_material" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "visit_material_job_id_idx" ON "visit_material" USING btree ("job_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "visit_material_entry_key_idx" ON "visit_material" USING btree ("company_id","entry_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "visit_skip_company_id_idx" ON "visit_skip" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "visit_skip_job_id_idx" ON "visit_skip" USING btree ("job_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "visit_skip_open_idx" ON "visit_skip" USING btree ("job_id") WHERE "visit_skip"."resolved_at" is null;