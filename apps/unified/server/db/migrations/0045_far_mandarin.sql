CREATE TABLE IF NOT EXISTS "supervisory_visit" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"client_id" text NOT NULL,
	"visit_date" date NOT NULL,
	"supervisor_id" text,
	"caregiver_id" text,
	"visit_type" text DEFAULT 'home' NOT NULL,
	"client_feedback" text,
	"care_plan_followed" boolean,
	"caregiver_feedback" text,
	"concerns" text,
	"follow_up_notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "supervisory_interval_days" integer;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "supervisory_visit" ADD CONSTRAINT "supervisory_visit_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "supervisory_visit" ADD CONSTRAINT "supervisory_visit_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "supervisory_visit" ADD CONSTRAINT "supervisory_visit_supervisor_id_user_id_fk" FOREIGN KEY ("supervisor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "supervisory_visit" ADD CONSTRAINT "supervisory_visit_caregiver_id_user_id_fk" FOREIGN KEY ("caregiver_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "supervisory_visit_company_client_idx" ON "supervisory_visit" USING btree ("company_id","client_id","visit_date");