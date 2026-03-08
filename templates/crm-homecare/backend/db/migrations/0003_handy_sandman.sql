CREATE TABLE "adl_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"caregiver_id" text,
	"adl_category" text NOT NULL,
	"status" text NOT NULL,
	"assistance_level" text,
	"performed_at" timestamp DEFAULT now() NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "adl_requirements" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"adl_category" text NOT NULL,
	"assistance_level" text NOT NULL,
	"frequency" text,
	"special_instructions" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" text PRIMARY KEY NOT NULL,
	"alert_type" text NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"message" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"due_date" timestamp,
	"related_entity_type" text,
	"related_entity_id" text,
	"acknowledged_at" timestamp,
	"acknowledged_by_id" text,
	"resolved_at" timestamp,
	"resolved_by_id" text,
	"resolution" text,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "applications" (
	"id" text PRIMARY KEY NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"email" text,
	"phone" text,
	"address" text,
	"city" text,
	"state" text,
	"zip" text,
	"status" text DEFAULT 'new' NOT NULL,
	"desired_position" text,
	"desired_pay_rate" numeric(8, 2),
	"available_start_date" date,
	"experience" text,
	"has_cna" boolean DEFAULT false NOT NULL,
	"has_lpn" boolean DEFAULT false NOT NULL,
	"has_rn" boolean DEFAULT false NOT NULL,
	"has_cpr" boolean DEFAULT false NOT NULL,
	"has_first_aid" boolean DEFAULT false NOT NULL,
	"references" json DEFAULT '[]'::json NOT NULL,
	"notes" text,
	"interview_notes" text,
	"hired_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"type" text,
	"title" text NOT NULL,
	"message" text,
	"is_read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "help_articles" (
	"id" text PRIMARY KEY NOT NULL,
	"agency_id" text NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"category" text,
	"tags" json DEFAULT '[]'::json NOT NULL,
	"is_faq" boolean DEFAULT false NOT NULL,
	"published" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"view_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead" (
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
CREATE TABLE "lead_source" (
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
CREATE TABLE "portal_message_threads" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"subject" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"last_message_at" timestamp DEFAULT now() NOT NULL,
	"client_last_read_at" timestamp,
	"staff_last_read_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portal_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"thread_id" text NOT NULL,
	"sender_type" text NOT NULL,
	"sender_name" text,
	"body" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agencies" ALTER COLUMN "primary_color" SET DEFAULT '{{PRIMARY_COLOR}}';--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "portal_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "portal_token" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "portal_token_exp" timestamp;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "last_portal_visit" timestamp;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "portal_email" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "portal_password_hash" text;--> statement-breakpoint
ALTER TABLE "adl_logs" ADD CONSTRAINT "adl_logs_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adl_logs" ADD CONSTRAINT "adl_logs_caregiver_id_users_id_fk" FOREIGN KEY ("caregiver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adl_requirements" ADD CONSTRAINT "adl_requirements_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_acknowledged_by_id_users_id_fk" FOREIGN KEY ("acknowledged_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_resolved_by_id_users_id_fk" FOREIGN KEY ("resolved_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_hired_user_id_users_id_fk" FOREIGN KEY ("hired_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_notifications" ADD CONSTRAINT "client_notifications_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead" ADD CONSTRAINT "lead_source_id_lead_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."lead_source"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead" ADD CONSTRAINT "lead_company_id_agencies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_source" ADD CONSTRAINT "lead_source_company_id_agencies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_message_threads" ADD CONSTRAINT "portal_message_threads_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_messages" ADD CONSTRAINT "portal_messages_thread_id_portal_message_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."portal_message_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "adl_logs_client_id_idx" ON "adl_logs" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "adl_logs_performed_at_idx" ON "adl_logs" USING btree ("performed_at");--> statement-breakpoint
CREATE INDEX "adl_requirements_client_id_idx" ON "adl_requirements" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "alerts_status_idx" ON "alerts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "alerts_alert_type_idx" ON "alerts" USING btree ("alert_type");--> statement-breakpoint
CREATE INDEX "alerts_priority_idx" ON "alerts" USING btree ("priority");--> statement-breakpoint
CREATE INDEX "applications_status_idx" ON "applications" USING btree ("status");--> statement-breakpoint
CREATE INDEX "applications_created_at_idx" ON "applications" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "client_notifications_client_id_idx" ON "client_notifications" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "client_notifications_is_read_idx" ON "client_notifications" USING btree ("is_read");--> statement-breakpoint
CREATE INDEX "help_articles_agency_id_idx" ON "help_articles" USING btree ("agency_id");--> statement-breakpoint
CREATE INDEX "help_articles_category_idx" ON "help_articles" USING btree ("category");--> statement-breakpoint
CREATE INDEX "lead_company_id_idx" ON "lead" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "lead_status_idx" ON "lead" USING btree ("status");--> statement-breakpoint
CREATE INDEX "lead_source_platform_idx2" ON "lead" USING btree ("source_platform");--> statement-breakpoint
CREATE INDEX "lead_received_at_idx" ON "lead" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "lead_source_company_id_idx" ON "lead_source" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "lead_source_platform_idx" ON "lead_source" USING btree ("platform");--> statement-breakpoint
CREATE INDEX "portal_message_threads_client_id_idx" ON "portal_message_threads" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "portal_message_threads_last_message_idx" ON "portal_message_threads" USING btree ("last_message_at");--> statement-breakpoint
CREATE INDEX "portal_messages_thread_created_idx" ON "portal_messages" USING btree ("thread_id","created_at");