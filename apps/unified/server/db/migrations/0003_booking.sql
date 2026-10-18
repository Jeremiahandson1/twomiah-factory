CREATE TABLE IF NOT EXISTS "booking" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"service_id" text,
	"contact_id" text,
	"series_id" text,
	"series_index" integer,
	"start_at" timestamp NOT NULL,
	"end_at" timestamp NOT NULL,
	"customer_name" text NOT NULL,
	"customer_email" text NOT NULL,
	"customer_phone" text,
	"customer_address" text,
	"customer_zip" text,
	"customer_notes" text,
	"status" text DEFAULT 'confirmed' NOT NULL,
	"assigned_user_id" text,
	"source" text DEFAULT 'public' NOT NULL,
	"source_path" text,
	"source_referrer" text,
	"source_variant" text,
	"token" text NOT NULL,
	"deposit_amount" numeric(12, 2),
	"deposit_status" text DEFAULT 'none' NOT NULL,
	"payment_intent_id" text,
	"deposit_paid_at" timestamp,
	"tip_amount" numeric(12, 2),
	"reminder_email_sent_at" timestamp,
	"reminder_sms_sent_at" timestamp,
	"rebook_reminder_sent_at" timestamp,
	"review_request_sent_at" timestamp,
	"external_event_id" text,
	"external_provider" text,
	"cancelled_at" timestamp,
	"cancelled_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "booking_ban" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"email" text,
	"phone" text,
	"reason" text,
	"added_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "booking_blackout" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"user_id" text,
	"date" text NOT NULL,
	"start_minute" integer,
	"end_minute" integer,
	"reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "booking_hours" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"user_id" text,
	"day_of_week" integer NOT NULL,
	"start_minute" integer NOT NULL,
	"end_minute" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "booking_series" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"service_id" text NOT NULL,
	"contact_id" text,
	"frequency" text NOT NULL,
	"interval_count" integer DEFAULT 1 NOT NULL,
	"first_start_at" timestamp NOT NULL,
	"occurrences_count" integer,
	"until_date" text,
	"customer_name" text NOT NULL,
	"customer_email" text NOT NULL,
	"customer_phone" text,
	"customer_address" text,
	"customer_zip" text,
	"customer_notes" text,
	"assigned_user_id" text,
	"status" text DEFAULT 'active' NOT NULL,
	"token" text NOT NULL,
	"cancelled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "booking_service" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"duration_minutes" integer NOT NULL,
	"price" numeric(12, 2),
	"deposit_amount" numeric(12, 2),
	"deposit_percent" integer,
	"buffer_before_minutes" integer DEFAULT 0 NOT NULL,
	"buffer_after_minutes" integer DEFAULT 0 NOT NULL,
	"slot_step_minutes" integer DEFAULT 30 NOT NULL,
	"capacity" integer DEFAULT 1 NOT NULL,
	"tip_presets" json,
	"rebook_interval_days" integer,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "booking_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"timezone" text DEFAULT 'America/Chicago' NOT NULL,
	"lead_time_minutes" integer DEFAULT 60 NOT NULL,
	"max_days_out" integer DEFAULT 30 NOT NULL,
	"drive_time_minutes" integer DEFAULT 0 NOT NULL,
	"self_service_cutoff_minutes" integer DEFAULT 60 NOT NULL,
	"deposit_hold_minutes" integer DEFAULT 30 NOT NULL,
	"require_address" boolean,
	"require_phone" boolean DEFAULT true NOT NULL,
	"notify_email" boolean DEFAULT true NOT NULL,
	"notify_sms" boolean DEFAULT false NOT NULL,
	"hero_title" text,
	"hero_subtitle" text,
	"confirm_cta" text,
	"thanks_message" text,
	"confirmation_email_subject" text,
	"confirmation_email_intro" text,
	"review_link" text,
	"ical_feed_token" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "booking_waitlist" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"service_id" text NOT NULL,
	"customer_name" text NOT NULL,
	"customer_email" text NOT NULL,
	"customer_phone" text,
	"customer_zip" text,
	"preferred_from" text,
	"preferred_to" text,
	"notes" text,
	"status" text DEFAULT 'open' NOT NULL,
	"notified_at" timestamp,
	"booking_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "booking_webhook" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"url" text NOT NULL,
	"secret" text NOT NULL,
	"events" json DEFAULT '["*"]'::json NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_delivery_at" timestamp,
	"last_status" integer,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "booking_zone" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"user_id" text NOT NULL,
	"zips" json DEFAULT '[]'::json NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "calendar_connection" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"account_email" text,
	"access_token_enc" text NOT NULL,
	"refresh_token_enc" text,
	"expires_at" timestamp,
	"calendar_id" text,
	"watch_channel_id" text,
	"watch_resource_id" text,
	"watch_expires_at" timestamp,
	"last_sync_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "booking" ADD CONSTRAINT "booking_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "booking" ADD CONSTRAINT "booking_service_id_booking_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."booking_service"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "booking" ADD CONSTRAINT "booking_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "booking" ADD CONSTRAINT "booking_series_id_booking_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."booking_series"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "booking" ADD CONSTRAINT "booking_assigned_user_id_user_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "booking_ban" ADD CONSTRAINT "booking_ban_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "booking_ban" ADD CONSTRAINT "booking_ban_added_by_user_id_user_id_fk" FOREIGN KEY ("added_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "booking_blackout" ADD CONSTRAINT "booking_blackout_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "booking_blackout" ADD CONSTRAINT "booking_blackout_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "booking_hours" ADD CONSTRAINT "booking_hours_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "booking_hours" ADD CONSTRAINT "booking_hours_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "booking_series" ADD CONSTRAINT "booking_series_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "booking_series" ADD CONSTRAINT "booking_series_service_id_booking_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."booking_service"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "booking_series" ADD CONSTRAINT "booking_series_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "booking_series" ADD CONSTRAINT "booking_series_assigned_user_id_user_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "booking_service" ADD CONSTRAINT "booking_service_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "booking_settings" ADD CONSTRAINT "booking_settings_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "booking_waitlist" ADD CONSTRAINT "booking_waitlist_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "booking_waitlist" ADD CONSTRAINT "booking_waitlist_service_id_booking_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."booking_service"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "booking_waitlist" ADD CONSTRAINT "booking_waitlist_booking_id_booking_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."booking"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "booking_webhook" ADD CONSTRAINT "booking_webhook_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "booking_zone" ADD CONSTRAINT "booking_zone_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "booking_zone" ADD CONSTRAINT "booking_zone_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "calendar_connection" ADD CONSTRAINT "calendar_connection_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "calendar_connection" ADD CONSTRAINT "calendar_connection_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "booking_token_key" ON "booking" USING btree ("token");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "booking_company_id_start_at_idx" ON "booking" USING btree ("company_id","start_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "booking_company_id_status_idx" ON "booking" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "booking_series_id_idx" ON "booking" USING btree ("series_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "booking_contact_id_idx" ON "booking" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "booking_ban_company_id_idx" ON "booking_ban" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "booking_blackout_company_id_date_idx" ON "booking_blackout" USING btree ("company_id","date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "booking_hours_company_id_day_of_week_idx" ON "booking_hours" USING btree ("company_id","day_of_week");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "booking_series_token_key" ON "booking_series" USING btree ("token");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "booking_series_company_id_status_idx" ON "booking_series" USING btree ("company_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "booking_service_company_id_slug_key" ON "booking_service" USING btree ("company_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "booking_settings_company_id_key" ON "booking_settings" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "booking_waitlist_company_id_service_id_status_idx" ON "booking_waitlist" USING btree ("company_id","service_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "booking_webhook_company_id_idx" ON "booking_webhook" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "booking_zone_company_id_idx" ON "booking_zone" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "calendar_connection_user_id_provider_key" ON "calendar_connection" USING btree ("user_id","provider");