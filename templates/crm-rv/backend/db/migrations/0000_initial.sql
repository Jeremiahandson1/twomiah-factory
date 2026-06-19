CREATE TABLE IF NOT EXISTS "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text,
	"entity_name" text,
	"changes" json,
	"metadata" json,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"user_id" text,
	"user_name" text,
	"user_email" text,
	"company_id" text NOT NULL
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
	"logo" text,
	"primary_color" text DEFAULT '{{PRIMARY_COLOR}}' NOT NULL,
	"secondary_color" text,
	"website" text,
	"license_number" text,
	"enabled_features" json DEFAULT '[]'::json NOT NULL,
	"settings" json DEFAULT '{}'::json NOT NULL,
	"integrations" json DEFAULT '{}'::json NOT NULL,
	"stripe_customer_id" text,
	"subscription_tier" text,
	"license_type" text,
	"lifetime_access" boolean DEFAULT false NOT NULL,
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
	"type" text DEFAULT 'lead' NOT NULL,
	"name" text NOT NULL,
	"company" text,
	"email" text,
	"phone" text,
	"mobile" text,
	"address" text,
	"city" text,
	"state" text,
	"zip" text,
	"lat" real,
	"lng" real,
	"notes" text,
	"source" text,
	"tags" json DEFAULT '[]'::json NOT NULL,
	"custom_fields" json DEFAULT '{}'::json NOT NULL,
	"portal_enabled" boolean DEFAULT false NOT NULL,
	"portal_token" text,
	"portal_token_exp" timestamp,
	"last_portal_visit" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lead" (
	"id" text PRIMARY KEY NOT NULL,
	"source_platform" text NOT NULL,
	"source_id" text,
	"customer_name" text NOT NULL,
	"email" text,
	"phone" text,
	"unit_interest" text,
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
CREATE TABLE IF NOT EXISTS "message" (
	"id" text PRIMARY KEY NOT NULL,
	"direction" text NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"channel" text DEFAULT 'sms' NOT NULL,
	"media_urls" json DEFAULT '[]'::json NOT NULL,
	"from_number" text,
	"to_number" text,
	"twilio_sid" text,
	"error_message" text,
	"read_at" timestamp,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"contact_id" text,
	"user_id" text,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "push_subscription" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "push_subscription_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "repair_order" (
	"id" text PRIMARY KEY NOT NULL,
	"ro_number" text,
	"write_up_date" timestamp DEFAULT now() NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"customer_unit_info" json,
	"services" json DEFAULT '[]'::json NOT NULL,
	"advisor_name" text,
	"estimated_total" numeric(10, 2),
	"actual_total" numeric(10, 2),
	"notes" text,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"customer_id" text NOT NULL,
	"unit_id" text,
	"technician_id" text,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sales_lead" (
	"id" text PRIMARY KEY NOT NULL,
	"source" text,
	"stage" text DEFAULT 'new' NOT NULL,
	"notes" text,
	"trade_in_info" json,
	"follow_up_date" timestamp,
	"closed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"contact_id" text NOT NULL,
	"unit_id" text,
	"assigned_to" text,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sequence" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"trigger" text DEFAULT 'manual' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sequence_enrollment" (
	"id" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"current_step" integer DEFAULT 0 NOT NULL,
	"next_run_at" timestamp,
	"enrolled_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"sequence_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sequence_step" (
	"id" text PRIMARY KEY NOT NULL,
	"step_order" integer NOT NULL,
	"delay_hours" integer DEFAULT 0 NOT NULL,
	"channel" text DEFAULT 'sms' NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"sequence_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "service_sales_alert" (
	"id" text PRIMARY KEY NOT NULL,
	"alert_message" text,
	"alerted_at" timestamp DEFAULT now() NOT NULL,
	"dismissed_at" timestamp,
	"converted_to_lead" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"repair_order_id" text NOT NULL,
	"sales_lead_id" text,
	"salesperson_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "support_knowledge_base" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"category" text,
	"tags" json DEFAULT '[]'::json NOT NULL,
	"is_faq" boolean DEFAULT false NOT NULL,
	"published" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"view_count" integer DEFAULT 0 NOT NULL,
	"company_id" text NOT NULL,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "support_sla_policy" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"priority" text NOT NULL,
	"response_time_minutes" integer NOT NULL,
	"resolve_time_minutes" integer NOT NULL,
	"escalate_after_minutes" integer,
	"active" boolean DEFAULT true NOT NULL,
	"company_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "support_ticket" (
	"id" text PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"subject" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'open' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"category" text,
	"type" text DEFAULT 'internal' NOT NULL,
	"source" text DEFAULT 'portal' NOT NULL,
	"sla_response_due" timestamp,
	"sla_resolve_due" timestamp,
	"first_response_at" timestamp,
	"resolved_at" timestamp,
	"closed_at" timestamp,
	"escalated_at" timestamp,
	"escalation_level" integer DEFAULT 0 NOT NULL,
	"ai_suggested" boolean DEFAULT false NOT NULL,
	"ai_category" text,
	"ai_priority_score" integer,
	"rating" integer,
	"rating_comment" text,
	"contact_id" text,
	"assigned_to_id" text,
	"created_by_id" text,
	"company_id" text NOT NULL,
	"tags" json DEFAULT '[]'::json NOT NULL,
	"metadata" json DEFAULT '{}'::json NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "support_ticket_message" (
	"id" text PRIMARY KEY NOT NULL,
	"body" text NOT NULL,
	"is_internal" boolean DEFAULT false NOT NULL,
	"is_ai" boolean DEFAULT false NOT NULL,
	"attachments" json DEFAULT '[]'::json NOT NULL,
	"ticket_id" text NOT NULL,
	"user_id" text,
	"contact_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "unit" (
	"id" text PRIMARY KEY NOT NULL,
	"category" text NOT NULL,
	"condition" text DEFAULT 'new' NOT NULL,
	"stock_number" text,
	"vin" text,
	"year" integer,
	"make" text,
	"model_name" text,
	"trim" text,
	"status" text DEFAULT 'available' NOT NULL,
	"msrp" numeric(10, 2),
	"listed_price" numeric(10, 2),
	"internet_price" numeric(10, 2),
	"cost" numeric(10, 2),
	"photos" json DEFAULT '[]'::json NOT NULL,
	"floorplan_img" text,
	"description" text,
	"features" json DEFAULT '[]'::json NOT NULL,
	"exterior_color" text,
	"interior_color" text,
	"rv_class" text,
	"towable_type" text,
	"length_ft" numeric(5, 1),
	"sleeps" integer,
	"slide_outs" integer,
	"gvwr" integer,
	"dry_weight" integer,
	"hitch_weight" integer,
	"chassis" text,
	"fresh_tank_gal" integer,
	"grey_tank_gal" integer,
	"black_tank_gal" integer,
	"generator_hours" integer,
	"awnings" integer,
	"fuel_type" text,
	"engine" text,
	"engine_cc" integer,
	"mileage" integer,
	"hours" integer,
	"transmission" text,
	"drivetrain" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"phone" text,
	"avatar" text,
	"role" text DEFAULT 'user' NOT NULL,
	"hourly_rate" numeric(10, 2),
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
 ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
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
 ALTER TABLE "message" ADD CONSTRAINT "message_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "message" ADD CONSTRAINT "message_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "message" ADD CONSTRAINT "message_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "push_subscription" ADD CONSTRAINT "push_subscription_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "repair_order" ADD CONSTRAINT "repair_order_customer_id_contact_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "repair_order" ADD CONSTRAINT "repair_order_unit_id_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."unit"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "repair_order" ADD CONSTRAINT "repair_order_technician_id_user_id_fk" FOREIGN KEY ("technician_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "repair_order" ADD CONSTRAINT "repair_order_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sales_lead" ADD CONSTRAINT "sales_lead_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sales_lead" ADD CONSTRAINT "sales_lead_unit_id_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."unit"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sales_lead" ADD CONSTRAINT "sales_lead_assigned_to_user_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sales_lead" ADD CONSTRAINT "sales_lead_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sequence" ADD CONSTRAINT "sequence_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sequence_enrollment" ADD CONSTRAINT "sequence_enrollment_sequence_id_sequence_id_fk" FOREIGN KEY ("sequence_id") REFERENCES "public"."sequence"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sequence_enrollment" ADD CONSTRAINT "sequence_enrollment_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sequence_enrollment" ADD CONSTRAINT "sequence_enrollment_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sequence_step" ADD CONSTRAINT "sequence_step_sequence_id_sequence_id_fk" FOREIGN KEY ("sequence_id") REFERENCES "public"."sequence"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "service_sales_alert" ADD CONSTRAINT "service_sales_alert_repair_order_id_repair_order_id_fk" FOREIGN KEY ("repair_order_id") REFERENCES "public"."repair_order"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "service_sales_alert" ADD CONSTRAINT "service_sales_alert_sales_lead_id_sales_lead_id_fk" FOREIGN KEY ("sales_lead_id") REFERENCES "public"."sales_lead"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "service_sales_alert" ADD CONSTRAINT "service_sales_alert_salesperson_id_user_id_fk" FOREIGN KEY ("salesperson_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "service_sales_alert" ADD CONSTRAINT "service_sales_alert_customer_id_contact_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "service_sales_alert" ADD CONSTRAINT "service_sales_alert_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "support_knowledge_base" ADD CONSTRAINT "support_knowledge_base_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "support_knowledge_base" ADD CONSTRAINT "support_knowledge_base_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "support_sla_policy" ADD CONSTRAINT "support_sla_policy_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "support_ticket" ADD CONSTRAINT "support_ticket_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "support_ticket" ADD CONSTRAINT "support_ticket_assigned_to_id_user_id_fk" FOREIGN KEY ("assigned_to_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "support_ticket" ADD CONSTRAINT "support_ticket_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "support_ticket" ADD CONSTRAINT "support_ticket_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "support_ticket_message" ADD CONSTRAINT "support_ticket_message_ticket_id_support_ticket_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."support_ticket"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "support_ticket_message" ADD CONSTRAINT "support_ticket_message_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "support_ticket_message" ADD CONSTRAINT "support_ticket_message_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "unit" ADD CONSTRAINT "unit_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
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
CREATE INDEX IF NOT EXISTS "audit_log_company_id_idx" ON "audit_log" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_entity_entity_id_idx" ON "audit_log" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_user_id_idx" ON "audit_log" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_created_at_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contact_company_id_idx" ON "contact" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contact_type_idx" ON "contact" USING btree ("type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lead_company_id_idx" ON "lead" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lead_status_idx" ON "lead" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lead_src_platform_idx" ON "lead" USING btree ("source_platform");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lead_received_at_idx" ON "lead" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lead_source_company_id_idx" ON "lead_source" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lead_source_platform_idx" ON "lead_source" USING btree ("platform");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "message_company_id_idx" ON "message" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "message_contact_id_idx" ON "message" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "message_created_at_idx" ON "message" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "push_subscription_user_id_idx" ON "push_subscription" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "repair_order_company_id_idx" ON "repair_order" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "repair_order_status_idx" ON "repair_order" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "repair_order_customer_id_idx" ON "repair_order" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "repair_order_ro_number_company_id_key" ON "repair_order" USING btree ("ro_number","company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_lead_company_id_idx" ON "sales_lead" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_lead_stage_idx" ON "sales_lead" USING btree ("stage");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_lead_assigned_to_idx" ON "sales_lead" USING btree ("assigned_to");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sales_lead_contact_id_idx" ON "sales_lead" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sequence_company_id_idx" ON "sequence" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sequence_enrollment_company_id_idx" ON "sequence_enrollment" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sequence_enrollment_next_run_idx" ON "sequence_enrollment" USING btree ("next_run_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sequence_enrollment_status_idx" ON "sequence_enrollment" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sequence_step_sequence_id_idx" ON "sequence_step" USING btree ("sequence_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "service_sales_alert_company_id_idx" ON "service_sales_alert" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "service_sales_alert_salesperson_id_idx" ON "service_sales_alert" USING btree ("salesperson_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "service_sales_alert_dismissed_at_idx" ON "service_sales_alert" USING btree ("dismissed_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_kb_company_id_idx" ON "support_knowledge_base" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_kb_category_idx" ON "support_knowledge_base" USING btree ("category");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_sla_policy_company_id_idx" ON "support_sla_policy" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_ticket_company_id_idx" ON "support_ticket" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_ticket_status_idx" ON "support_ticket" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_ticket_priority_idx" ON "support_ticket" USING btree ("priority");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_ticket_assigned_to_idx" ON "support_ticket" USING btree ("assigned_to_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_ticket_contact_id_idx" ON "support_ticket" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_ticket_category_idx" ON "support_ticket" USING btree ("category");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_ticket_message_ticket_id_idx" ON "support_ticket_message" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "unit_company_id_idx" ON "unit" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "unit_status_idx" ON "unit" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "unit_category_idx" ON "unit" USING btree ("category");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "unit_make_idx" ON "unit" USING btree ("make");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "unit_vin_company_id_key" ON "unit" USING btree ("vin","company_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_email_company_id_key" ON "user" USING btree ("email","company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_company_id_idx" ON "user" USING btree ("company_id");