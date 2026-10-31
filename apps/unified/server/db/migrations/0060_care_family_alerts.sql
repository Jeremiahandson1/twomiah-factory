CREATE TABLE IF NOT EXISTS "alert_rule_log" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"rule_id" text NOT NULL,
	"time_entry_id" text NOT NULL,
	"recipient_id" text NOT NULL,
	"channel" text NOT NULL,
	"status" text NOT NULL,
	"detail" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "family_alert_rule" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"trigger" text NOT NULL,
	"minutes" integer,
	"audience" text NOT NULL,
	"channels" json NOT NULL,
	"message" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "family_push_subscription" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"family_member_id" text NOT NULL,
	"subscription" json NOT NULL,
	"endpoint" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX IF EXISTS "family_visit_text_key";--> statement-breakpoint
ALTER TABLE "family_members" ADD COLUMN "visit_email_consent_wording" text;--> statement-breakpoint
ALTER TABLE "family_visit_text" ADD COLUMN "rule_id" text DEFAULT '' NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "alert_rule_log" ADD CONSTRAINT "alert_rule_log_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "alert_rule_log" ADD CONSTRAINT "alert_rule_log_rule_id_family_alert_rule_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."family_alert_rule"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "alert_rule_log" ADD CONSTRAINT "alert_rule_log_time_entry_id_time_entries_id_fk" FOREIGN KEY ("time_entry_id") REFERENCES "public"."time_entries"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "family_alert_rule" ADD CONSTRAINT "family_alert_rule_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "family_alert_rule" ADD CONSTRAINT "family_alert_rule_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "family_push_subscription" ADD CONSTRAINT "family_push_subscription_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "family_push_subscription" ADD CONSTRAINT "family_push_subscription_family_member_id_family_members_id_fk" FOREIGN KEY ("family_member_id") REFERENCES "public"."family_members"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "alert_rule_log_company_idx" ON "alert_rule_log" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "alert_rule_log_key" ON "alert_rule_log" USING btree ("rule_id","time_entry_id","recipient_id","channel");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "family_alert_rule_company_idx" ON "family_alert_rule" USING btree ("company_id","trigger");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "family_push_subscription_member_idx" ON "family_push_subscription" USING btree ("family_member_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "family_push_subscription_endpoint_idx" ON "family_push_subscription" USING btree ("company_id","endpoint");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "family_visit_text_key" ON "family_visit_text" USING btree ("time_entry_id","family_member_id","event","channel","rule_id");