CREATE TABLE IF NOT EXISTS "adjuster_contact" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"email" text,
	"company_name" text,
	"insurance_carrier" text NOT NULL,
	"territory" text,
	"notes" text,
	"jobs_worked_together" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "canvassing_script" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"steps" json DEFAULT '[]'::json NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "canvassing_session" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"center_lat" numeric(10, 7),
	"center_lng" numeric(10, 7),
	"radius_miles" numeric(5, 2),
	"weather_event" text,
	"total_doors" integer DEFAULT 0 NOT NULL,
	"answered_doors" integer DEFAULT 0 NOT NULL,
	"leads_created" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp,
	"ended_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "canvassing_stop" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"session_id" text NOT NULL,
	"user_id" text NOT NULL,
	"address" text,
	"city" text,
	"state" text,
	"zip" text,
	"lat" numeric(10, 7),
	"lng" numeric(10, 7),
	"outcome" text DEFAULT 'no_answer' NOT NULL,
	"notes" text,
	"job_id" text,
	"contact_id" text,
	"door_hanger_left" boolean DEFAULT false NOT NULL,
	"follow_up_date" timestamp,
	"photos" json DEFAULT '[]'::json NOT NULL,
	"visited_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "claim_activity" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"job_id" text NOT NULL,
	"claim_id" text NOT NULL,
	"user_id" text,
	"activity_type" text NOT NULL,
	"body" text NOT NULL,
	"metadata" json,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "crew" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"foreman_name" text NOT NULL,
	"foreman_phone" text NOT NULL,
	"size" integer NOT NULL,
	"is_subcontractor" boolean DEFAULT false NOT NULL,
	"subcontractor_company_name" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "insurance_claim" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"job_id" text NOT NULL,
	"claim_number" text NOT NULL,
	"insurance_company" text NOT NULL,
	"policy_number" text,
	"adjuster_name" text,
	"adjuster_phone" text,
	"adjuster_email" text,
	"adjuster_company" text,
	"date_of_loss" timestamp,
	"cause_of_loss" text,
	"deductible" numeric(10, 2),
	"rcv" numeric(10, 2),
	"acv" numeric(10, 2),
	"depreciation_held" numeric(10, 2),
	"supplement_amount" numeric(10, 2) DEFAULT '0' NOT NULL,
	"final_approved_amount" numeric(10, 2),
	"claim_status" text DEFAULT 'filed' NOT NULL,
	"claim_filed_date" timestamp,
	"adjuster_inspection_date" timestamp,
	"approval_date" timestamp,
	"xactimate_scope_url" text,
	"xactimate_export_url" text,
	"denial_reason" text,
	"internal_notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "insurance_claim_job_id_unique" UNIQUE("job_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "job_note" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"job_id" text NOT NULL,
	"user_id" text NOT NULL,
	"body" text NOT NULL,
	"is_internal" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "material" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"job_id" text NOT NULL,
	"supplier" text NOT NULL,
	"order_status" text DEFAULT 'not_ordered' NOT NULL,
	"order_date" timestamp,
	"delivery_date" timestamp,
	"line_items" json NOT NULL,
	"total_cost" numeric(10, 2),
	"supplier_order_number" text,
	"delivery_address" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "measurement_report" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"job_id" text,
	"address" text NOT NULL,
	"city" text NOT NULL,
	"state" text NOT NULL,
	"zip" text NOT NULL,
	"provider" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"total_squares" numeric(10, 2),
	"total_area" numeric(10, 2),
	"segments" json,
	"imagery_quality" text,
	"imagery_date" text,
	"pitch_degrees" json,
	"center" json,
	"report_url" text,
	"report_pdf_url" text,
	"raw_data" json,
	"cost" numeric(10, 2) DEFAULT '9.00' NOT NULL,
	"external_provider" text,
	"external_order_id" text,
	"external_status" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "provider_integration" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"provider" text NOT NULL,
	"client_id" text,
	"client_secret" text,
	"access_token" text,
	"refresh_token" text,
	"token_expires_at" timestamp,
	"realm_id" text,
	"webhook_secret" text,
	"connected" boolean DEFAULT false NOT NULL,
	"last_synced_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "storm_event" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"event_date" timestamp NOT NULL,
	"event_type" text NOT NULL,
	"affected_zip_codes" json DEFAULT '[]'::json NOT NULL,
	"hail_size_inches" numeric(4, 2),
	"wind_speed_mph" integer,
	"description" text,
	"lead_count" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'detected' NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "storm_lead" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"storm_event_id" text NOT NULL,
	"address" text,
	"city" text,
	"state" text,
	"zip" text,
	"lat" numeric(10, 7),
	"lng" numeric(10, 7),
	"job_id" text,
	"contact_id" text,
	"status" text DEFAULT 'new' NOT NULL,
	"estimated_damage" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "storm_radar_event" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"provider" text DEFAULT 'noaa' NOT NULL,
	"provider_event_id" text,
	"event_type" text NOT NULL,
	"severity" text,
	"hail_size_inches" numeric(4, 2),
	"wind_speed_mph" integer,
	"description" text,
	"lat" real,
	"lng" real,
	"radius_miles" numeric(6, 2),
	"state" text,
	"city" text,
	"zip" text,
	"started_at" timestamp NOT NULL,
	"ended_at" timestamp,
	"raw_payload" json,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "storm_event_match" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"storm_radar_event_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"distance_miles" numeric(6, 2),
	"status" text DEFAULT 'new' NOT NULL,
	"contacted_at" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "supplement" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"job_id" text NOT NULL,
	"claim_id" text NOT NULL,
	"supplement_number" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"reason" text NOT NULL,
	"line_items" json NOT NULL,
	"total_amount" numeric(10, 2) NOT NULL,
	"submitted_at" timestamp,
	"responded_at" timestamp,
	"approved_amount" numeric(10, 2),
	"denial_reason" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "report_credits" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "report_price_per_report" numeric(10, 2) DEFAULT '9.00' NOT NULL;--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN "property_type" text;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "assigned_sales_rep_id" text;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "assigned_crew_id" text;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "roof_age" integer;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "roof_type" text;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "stories" integer;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "claim_number" text;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "insurance_company" text;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "adjuster_name" text;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "adjuster_phone" text;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "date_of_loss" timestamp;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "deductible" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "rcv" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "acv" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "approved_scope" text;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "final_revenue" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "material_cost" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "labor_cost" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "inspection_date" timestamp;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "inspection_notes" text;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "install_date" timestamp;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "install_end_date" timestamp;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "measurement_report_id" text;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "total_squares" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "lost_reason" text;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "closed_at" timestamp;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "job_id" text;--> statement-breakpoint
ALTER TABLE "roof_report" ADD COLUMN "imagery_source" text DEFAULT 'google_solar';--> statement-breakpoint
ALTER TABLE "roof_report" ADD COLUMN "elevation_source" text DEFAULT 'google_dsm';--> statement-breakpoint
ALTER TABLE "roof_report" ADD COLUMN "nearmap_survey_id" text;--> statement-breakpoint
ALTER TABLE "roof_report" ADD COLUMN "dsm_grid_path" text;--> statement-breakpoint
ALTER TABLE "roof_report" ADD COLUMN "pdf_path" text;--> statement-breakpoint
ALTER TABLE "roof_report" ADD COLUMN "sam_segments" json;--> statement-breakpoint
ALTER TABLE "roof_report" ADD COLUMN "roof_condition" integer;--> statement-breakpoint
ALTER TABLE "roof_report" ADD COLUMN "roof_material" text;--> statement-breakpoint
ALTER TABLE "roof_report" ADD COLUMN "tree_overhang_pct" real;--> statement-breakpoint
ALTER TABLE "roof_report" ADD COLUMN "ai_source" text;--> statement-breakpoint
ALTER TABLE "job_photo" ADD COLUMN "photo_type" text DEFAULT 'general' NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "adjuster_contact" ADD CONSTRAINT "adjuster_contact_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "canvassing_script" ADD CONSTRAINT "canvassing_script_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "canvassing_session" ADD CONSTRAINT "canvassing_session_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "canvassing_session" ADD CONSTRAINT "canvassing_session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "canvassing_stop" ADD CONSTRAINT "canvassing_stop_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "canvassing_stop" ADD CONSTRAINT "canvassing_stop_session_id_canvassing_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."canvassing_session"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "canvassing_stop" ADD CONSTRAINT "canvassing_stop_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "canvassing_stop" ADD CONSTRAINT "canvassing_stop_job_id_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "canvassing_stop" ADD CONSTRAINT "canvassing_stop_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "claim_activity" ADD CONSTRAINT "claim_activity_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "claim_activity" ADD CONSTRAINT "claim_activity_job_id_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "claim_activity" ADD CONSTRAINT "claim_activity_claim_id_insurance_claim_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."insurance_claim"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "claim_activity" ADD CONSTRAINT "claim_activity_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "crew" ADD CONSTRAINT "crew_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "insurance_claim" ADD CONSTRAINT "insurance_claim_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "insurance_claim" ADD CONSTRAINT "insurance_claim_job_id_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_note" ADD CONSTRAINT "job_note_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_note" ADD CONSTRAINT "job_note_job_id_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_note" ADD CONSTRAINT "job_note_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "material" ADD CONSTRAINT "material_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "material" ADD CONSTRAINT "material_job_id_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "measurement_report" ADD CONSTRAINT "measurement_report_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "measurement_report" ADD CONSTRAINT "measurement_report_job_id_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "provider_integration" ADD CONSTRAINT "provider_integration_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "storm_event" ADD CONSTRAINT "storm_event_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "storm_lead" ADD CONSTRAINT "storm_lead_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "storm_lead" ADD CONSTRAINT "storm_lead_storm_event_id_storm_event_id_fk" FOREIGN KEY ("storm_event_id") REFERENCES "public"."storm_event"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "storm_lead" ADD CONSTRAINT "storm_lead_job_id_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "storm_lead" ADD CONSTRAINT "storm_lead_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "storm_radar_event" ADD CONSTRAINT "storm_radar_event_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "storm_event_match" ADD CONSTRAINT "storm_event_match_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "storm_event_match" ADD CONSTRAINT "storm_event_match_storm_radar_event_id_storm_radar_event_id_fk" FOREIGN KEY ("storm_radar_event_id") REFERENCES "public"."storm_radar_event"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "supplement" ADD CONSTRAINT "supplement_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "supplement" ADD CONSTRAINT "supplement_job_id_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "supplement" ADD CONSTRAINT "supplement_claim_id_insurance_claim_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."insurance_claim"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "adjuster_contact_company_id_idx" ON "adjuster_contact" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "canvassing_script_company_id_idx" ON "canvassing_script" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "canvassing_session_company_id_idx" ON "canvassing_session" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "canvassing_session_user_id_idx" ON "canvassing_session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "canvassing_stop_company_id_idx" ON "canvassing_stop" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "canvassing_stop_session_id_idx" ON "canvassing_stop" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "claim_activity_company_id_idx" ON "claim_activity" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "claim_activity_claim_id_idx" ON "claim_activity" USING btree ("claim_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "crew_company_id_idx" ON "crew" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "insurance_claim_company_id_idx" ON "insurance_claim" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "insurance_claim_job_id_idx" ON "insurance_claim" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_note_company_id_idx" ON "job_note" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "material_company_id_idx" ON "material" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "measurement_report_company_id_idx" ON "measurement_report" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "provider_integration_company_id_idx" ON "provider_integration" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "provider_integration_company_provider_uniq" ON "provider_integration" USING btree ("company_id","provider");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "storm_event_company_id_idx" ON "storm_event" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "storm_lead_company_id_idx" ON "storm_lead" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "storm_lead_event_id_idx" ON "storm_lead" USING btree ("storm_event_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "storm_radar_event_company_id_idx" ON "storm_radar_event" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "storm_radar_event_state_idx" ON "storm_radar_event" USING btree ("state");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "storm_radar_event_zip_idx" ON "storm_radar_event" USING btree ("zip");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "storm_radar_event_started_at_idx" ON "storm_radar_event" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "storm_event_match_company_id_idx" ON "storm_event_match" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "storm_event_match_storm_radar_event_id_idx" ON "storm_event_match" USING btree ("storm_radar_event_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "storm_event_match_status_idx" ON "storm_event_match" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "supplement_company_id_idx" ON "supplement" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "supplement_claim_id_idx" ON "supplement" USING btree ("claim_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job" ADD CONSTRAINT "job_assigned_sales_rep_id_user_id_fk" FOREIGN KEY ("assigned_sales_rep_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job" ADD CONSTRAINT "job_assigned_crew_id_crew_id_fk" FOREIGN KEY ("assigned_crew_id") REFERENCES "public"."crew"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job" ADD CONSTRAINT "job_measurement_report_id_measurement_report_id_fk" FOREIGN KEY ("measurement_report_id") REFERENCES "public"."measurement_report"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "quote" ADD CONSTRAINT "quote_job_id_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
