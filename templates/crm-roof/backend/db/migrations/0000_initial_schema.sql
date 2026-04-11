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
CREATE TABLE IF NOT EXISTS "ai_receptionist_rule" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"trigger" text NOT NULL,
	"channel" text NOT NULL,
	"message_template" text NOT NULL,
	"delay_minutes" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"keyword_match" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_receptionist_settings" (
	"company_id" text PRIMARY KEY NOT NULL,
	"is_enabled" boolean DEFAULT false NOT NULL,
	"business_hours_start" text DEFAULT '09:00' NOT NULL,
	"business_hours_end" text DEFAULT '17:00' NOT NULL,
	"timezone" text DEFAULT 'America/Chicago' NOT NULL,
	"greeting_text" text,
	"forwarding_number" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "call_log" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"tracking_number_id" text,
	"contact_id" text,
	"caller_number" text,
	"caller_name" text,
	"caller_city" text,
	"caller_state" text,
	"source" text,
	"campaign" text,
	"medium" text,
	"keyword" text,
	"landing_page" text,
	"direction" text DEFAULT 'inbound',
	"duration" integer,
	"status" text DEFAULT 'completed' NOT NULL,
	"start_time" timestamp,
	"end_time" timestamp,
	"recording_url" text,
	"transcription" text,
	"tags" json,
	"notes" text,
	"first_time_caller" boolean DEFAULT false,
	"provider_id" text,
	"is_lead" boolean DEFAULT false,
	"lead_value" numeric(12, 2),
	"ai_summary" text,
	"ai_response_sent" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL
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
CREATE TABLE IF NOT EXISTS "company" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"email" text,
	"phone" text,
	"address" text,
	"city" text,
	"state" text,
	"zip" text,
	"primary_color" text DEFAULT '{{PRIMARY_COLOR}}' NOT NULL,
	"enabled_features" json DEFAULT '[]'::json NOT NULL,
	"settings" json DEFAULT '{}'::json NOT NULL,
	"integrations" json DEFAULT '{}'::json NOT NULL,
	"report_credits" integer DEFAULT 3 NOT NULL,
	"report_price_per_report" numeric(10, 2) DEFAULT '9.00' NOT NULL,
	"estimator_enabled" boolean DEFAULT false NOT NULL,
	"price_per_square_low" numeric(10, 2) DEFAULT '350.00' NOT NULL,
	"price_per_square_high" numeric(10, 2) DEFAULT '550.00' NOT NULL,
	"estimator_headline" text DEFAULT 'Get Your Free Roof Estimate' NOT NULL,
	"estimator_disclaimer" text DEFAULT 'This is an automated estimate based on satellite data. Final pricing may vary after on-site inspection.' NOT NULL,
	"stripe_customer_id" text,
	"twilio_phone_number" text,
	"twilio_account_sid" text,
	"twilio_auth_token" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "company_slug_unique" UNIQUE("slug"),
	CONSTRAINT "company_stripe_customer_id_unique" UNIQUE("stripe_customer_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contact" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"email" text,
	"phone" text,
	"mobile_phone" text,
	"address" text,
	"city" text,
	"state" text,
	"zip" text,
	"lead_source" text,
	"property_type" text,
	"opted_out_sms" boolean DEFAULT false NOT NULL,
	"qb_customer_id" text,
	"portal_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
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
CREATE TABLE IF NOT EXISTS "invoice" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"job_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"invoice_number" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"line_items" json NOT NULL,
	"subtotal" numeric(10, 2) NOT NULL,
	"tax_rate" numeric(5, 4) NOT NULL,
	"tax_amount" numeric(10, 2) NOT NULL,
	"total" numeric(10, 2) NOT NULL,
	"amount_paid" numeric(10, 2) DEFAULT '0' NOT NULL,
	"balance" numeric(10, 2) NOT NULL,
	"due_date" timestamp,
	"paid_at" timestamp,
	"qb_invoice_id" text,
	"synced_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "job" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"assigned_sales_rep_id" text,
	"assigned_crew_id" text,
	"job_number" text NOT NULL,
	"job_type" text NOT NULL,
	"status" text DEFAULT 'lead' NOT NULL,
	"property_address" text NOT NULL,
	"city" text NOT NULL,
	"state" text NOT NULL,
	"zip" text NOT NULL,
	"roof_age" integer,
	"roof_type" text,
	"stories" integer,
	"claim_number" text,
	"insurance_company" text,
	"adjuster_name" text,
	"adjuster_phone" text,
	"date_of_loss" timestamp,
	"deductible" numeric(10, 2),
	"rcv" numeric(10, 2),
	"acv" numeric(10, 2),
	"approved_scope" text,
	"estimated_revenue" numeric(10, 2),
	"final_revenue" numeric(10, 2),
	"material_cost" numeric(10, 2),
	"labor_cost" numeric(10, 2),
	"inspection_date" timestamp,
	"inspection_notes" text,
	"install_date" timestamp,
	"install_end_date" timestamp,
	"measurement_report_id" text,
	"total_squares" numeric(10, 2),
	"source" text NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
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
CREATE TABLE IF NOT EXISTS "job_photo" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"job_id" text NOT NULL,
	"uploaded_by" text NOT NULL,
	"photo_type" text NOT NULL,
	"url" text NOT NULL,
	"thumbnail_url" text,
	"caption" text,
	"taken_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lead" (
	"id" text PRIMARY KEY NOT NULL,
	"source_platform" text NOT NULL,
	"source_id" text,
	"homeowner_name" text NOT NULL,
	"email" text,
	"phone" text,
	"job_type" text,
	"location" text,
	"budget" text,
	"description" text,
	"status" text DEFAULT 'new' NOT NULL,
	"raw_payload" json,
	"converted_contact_id" text,
	"contacted_at" timestamp,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lead_source" (
	"id" text PRIMARY KEY NOT NULL,
	"platform" text NOT NULL,
	"label" text NOT NULL,
	"inbound_email" text,
	"webhook_url" text,
	"webhook_secret" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"config" json DEFAULT '{}'::json NOT NULL,
	"company_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
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
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "phone_call" (
	"id" text PRIMARY KEY NOT NULL,
	"caller_number" text NOT NULL,
	"status" text NOT NULL,
	"duration" integer,
	"recording_url" text,
	"transcription" text,
	"tracking_number_id" text NOT NULL,
	"company_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "portal_session" (
	"id" text PRIMARY KEY NOT NULL,
	"contact_id" text NOT NULL,
	"company_id" text NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pricebook_category" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"company_id" text NOT NULL,
	"parent_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pricebook_good_better_best" (
	"id" text PRIMARY KEY NOT NULL,
	"pricebook_item_id" text NOT NULL,
	"tier" text NOT NULL,
	"name" text,
	"description" text,
	"price" numeric(12, 2) NOT NULL,
	"features" json
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pricebook_item" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"type" text DEFAULT 'service' NOT NULL,
	"code" text,
	"price" numeric(12, 2) NOT NULL,
	"cost" numeric(12, 2) DEFAULT '0' NOT NULL,
	"unit" text DEFAULT 'each' NOT NULL,
	"taxable" boolean DEFAULT true NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"company_id" text NOT NULL,
	"category_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pricebook_material" (
	"id" text PRIMARY KEY NOT NULL,
	"pricebook_item_id" text NOT NULL,
	"quantity" numeric(10, 4) DEFAULT '1' NOT NULL,
	"price_override" numeric(12, 2)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "qb_integration" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text NOT NULL,
	"realm_id" text NOT NULL,
	"token_expires_at" timestamp NOT NULL,
	"sync_enabled" boolean DEFAULT false NOT NULL,
	"last_synced_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "qb_integration_company_id_unique" UNIQUE("company_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "quote" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"job_id" text,
	"quote_number" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"line_items" json NOT NULL,
	"subtotal" numeric(10, 2) NOT NULL,
	"tax_rate" numeric(5, 4) NOT NULL,
	"tax_amount" numeric(10, 2) NOT NULL,
	"total" numeric(10, 2) NOT NULL,
	"notes" text,
	"customer_message" text,
	"expires_at" timestamp NOT NULL,
	"approved_at" timestamp,
	"declined_at" timestamp,
	"converted_to_job_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "roof_report" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"contact_id" text,
	"address" text NOT NULL,
	"city" text NOT NULL,
	"state" text NOT NULL,
	"zip" text NOT NULL,
	"lat" real NOT NULL,
	"lng" real NOT NULL,
	"formatted_address" text,
	"total_area_sqft" real NOT NULL,
	"total_squares" real NOT NULL,
	"segment_count" integer NOT NULL,
	"imagery_quality" text NOT NULL,
	"imagery_date" text,
	"aerial_image_path" text,
	"roof_mask_path" text,
	"segments" json NOT NULL,
	"edges" json NOT NULL,
	"measurements" json NOT NULL,
	"raw_solar_data" json,
	"user_edited" boolean DEFAULT false NOT NULL,
	"original_edges" json,
	"original_measurements" json,
	"imagery_source" text DEFAULT 'google_solar',
	"elevation_source" text DEFAULT 'google_dsm',
	"nearmap_survey_id" text,
	"dsm_grid_path" text,
	"pdf_path" text,
	"sam_segments" json,
	"roof_condition" integer,
	"roof_material" text,
	"tree_overhang_pct" real,
	"ai_source" text,
	"status" text DEFAULT 'paid' NOT NULL,
	"stripe_payment_intent_id" text,
	"amount_charged" numeric(10, 2) DEFAULT '9.99',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sms_message" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"job_id" text,
	"direction" text NOT NULL,
	"body" text NOT NULL,
	"from_number" text NOT NULL,
	"to_number" text NOT NULL,
	"twilio_sid" text,
	"created_at" timestamp DEFAULT now() NOT NULL
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
CREATE TABLE IF NOT EXISTS "tracking_number" (
	"id" text PRIMARY KEY NOT NULL,
	"phone_number" text NOT NULL,
	"forward_to" text,
	"name" text,
	"source" text,
	"campaign" text,
	"medium" text,
	"provider_id" text,
	"provider" text,
	"active" boolean DEFAULT true NOT NULL,
	"company_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"phone" text,
	"role" text DEFAULT 'user' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_login" timestamp,
	"refresh_token" text,
	"reset_token" text,
	"reset_token_exp" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "adjuster_contact" ADD CONSTRAINT "adjuster_contact_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_receptionist_rule" ADD CONSTRAINT "ai_receptionist_rule_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_receptionist_settings" ADD CONSTRAINT "ai_receptionist_settings_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "call_log" ADD CONSTRAINT "call_log_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "call_log" ADD CONSTRAINT "call_log_tracking_number_id_tracking_number_id_fk" FOREIGN KEY ("tracking_number_id") REFERENCES "public"."tracking_number"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "call_log" ADD CONSTRAINT "call_log_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE no action ON UPDATE no action;
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
 ALTER TABLE "contact" ADD CONSTRAINT "contact_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
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
 ALTER TABLE "invoice" ADD CONSTRAINT "invoice_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invoice" ADD CONSTRAINT "invoice_job_id_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "invoice" ADD CONSTRAINT "invoice_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job" ADD CONSTRAINT "job_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job" ADD CONSTRAINT "job_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job" ADD CONSTRAINT "job_assigned_sales_rep_id_user_id_fk" FOREIGN KEY ("assigned_sales_rep_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job" ADD CONSTRAINT "job_assigned_crew_id_crew_id_fk" FOREIGN KEY ("assigned_crew_id") REFERENCES "public"."crew"("id") ON DELETE no action ON UPDATE no action;
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
 ALTER TABLE "job_photo" ADD CONSTRAINT "job_photo_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_photo" ADD CONSTRAINT "job_photo_job_id_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_photo" ADD CONSTRAINT "job_photo_uploaded_by_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lead" ADD CONSTRAINT "lead_source_id_lead_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."lead_source"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lead" ADD CONSTRAINT "lead_converted_contact_id_contact_id_fk" FOREIGN KEY ("converted_contact_id") REFERENCES "public"."contact"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lead" ADD CONSTRAINT "lead_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lead_source" ADD CONSTRAINT "lead_source_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
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
 ALTER TABLE "phone_call" ADD CONSTRAINT "phone_call_tracking_number_id_tracking_number_id_fk" FOREIGN KEY ("tracking_number_id") REFERENCES "public"."tracking_number"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "phone_call" ADD CONSTRAINT "phone_call_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "portal_session" ADD CONSTRAINT "portal_session_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pricebook_category" ADD CONSTRAINT "pricebook_category_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pricebook_good_better_best" ADD CONSTRAINT "pricebook_good_better_best_pricebook_item_id_pricebook_item_id_fk" FOREIGN KEY ("pricebook_item_id") REFERENCES "public"."pricebook_item"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pricebook_item" ADD CONSTRAINT "pricebook_item_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pricebook_item" ADD CONSTRAINT "pricebook_item_category_id_pricebook_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."pricebook_category"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pricebook_material" ADD CONSTRAINT "pricebook_material_pricebook_item_id_pricebook_item_id_fk" FOREIGN KEY ("pricebook_item_id") REFERENCES "public"."pricebook_item"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "qb_integration" ADD CONSTRAINT "qb_integration_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "quote" ADD CONSTRAINT "quote_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "quote" ADD CONSTRAINT "quote_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "quote" ADD CONSTRAINT "quote_job_id_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "roof_report" ADD CONSTRAINT "roof_report_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "roof_report" ADD CONSTRAINT "roof_report_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sms_message" ADD CONSTRAINT "sms_message_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sms_message" ADD CONSTRAINT "sms_message_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sms_message" ADD CONSTRAINT "sms_message_job_id_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job"("id") ON DELETE no action ON UPDATE no action;
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
DO $$ BEGIN
 ALTER TABLE "tracking_number" ADD CONSTRAINT "tracking_number_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user" ADD CONSTRAINT "user_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "adjuster_contact_company_id_idx" ON "adjuster_contact" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_receptionist_rule_company_id_idx" ON "ai_receptionist_rule" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "call_log_company_id_idx" ON "call_log" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "call_log_contact_id_idx" ON "call_log" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "canvassing_script_company_id_idx" ON "canvassing_script" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "canvassing_session_company_id_idx" ON "canvassing_session" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "canvassing_session_user_id_idx" ON "canvassing_session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "canvassing_stop_company_id_idx" ON "canvassing_stop" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "canvassing_stop_session_id_idx" ON "canvassing_stop" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "claim_activity_company_id_idx" ON "claim_activity" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "claim_activity_claim_id_idx" ON "claim_activity" USING btree ("claim_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contact_company_id_idx" ON "contact" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "crew_company_id_idx" ON "crew" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "insurance_claim_company_id_idx" ON "insurance_claim" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "insurance_claim_job_id_idx" ON "insurance_claim" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoice_company_id_idx" ON "invoice" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoice_status_idx" ON "invoice" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_company_id_idx" ON "job" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_status_idx" ON "job" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_contact_id_idx" ON "job" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_note_company_id_idx" ON "job_note" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_photo_company_id_idx" ON "job_photo" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lead_company_id_idx" ON "lead" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lead_status_idx" ON "lead" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lead_platform_idx" ON "lead" USING btree ("source_platform");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lead_received_at_idx" ON "lead" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lead_source_company_id_idx" ON "lead_source" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lead_source_platform_idx" ON "lead_source" USING btree ("platform");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "material_company_id_idx" ON "material" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "measurement_report_company_id_idx" ON "measurement_report" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "phone_call_tracking_number_id_idx" ON "phone_call" USING btree ("tracking_number_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portal_session_company_id_idx" ON "portal_session" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pricebook_category_company_id_idx" ON "pricebook_category" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pricebook_good_better_best_pricebook_item_id_idx" ON "pricebook_good_better_best" USING btree ("pricebook_item_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pricebook_item_company_id_idx" ON "pricebook_item" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pricebook_item_category_id_idx" ON "pricebook_item" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pricebook_material_pricebook_item_id_idx" ON "pricebook_material" USING btree ("pricebook_item_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "qb_integration_company_id_idx" ON "qb_integration" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quote_company_id_idx" ON "quote" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quote_status_idx" ON "quote" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "roof_report_company_id_idx" ON "roof_report" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "roof_report_contact_id_idx" ON "roof_report" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sms_message_company_id_idx" ON "sms_message" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "storm_event_company_id_idx" ON "storm_event" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "storm_lead_company_id_idx" ON "storm_lead" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "storm_lead_event_id_idx" ON "storm_lead" USING btree ("storm_event_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "supplement_company_id_idx" ON "supplement" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "supplement_claim_id_idx" ON "supplement" USING btree ("claim_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tracking_number_company_id_idx" ON "tracking_number" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_email_company_id_key" ON "user" USING btree ("email","company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_company_id_idx" ON "user" USING btree ("company_id");