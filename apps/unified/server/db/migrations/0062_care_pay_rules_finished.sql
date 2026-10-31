CREATE TABLE IF NOT EXISTS "pay_hour_audit" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"caregiver_id" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"review_id" text,
	"segment_kind" text NOT NULL,
	"segment_date" date NOT NULL,
	"minutes" integer NOT NULL,
	"regular_minutes" integer DEFAULT 0 NOT NULL,
	"overtime_minutes" integer DEFAULT 0 NOT NULL,
	"double_time_minutes" integer DEFAULT 0 NOT NULL,
	"unpaid_minutes" integer DEFAULT 0 NOT NULL,
	"is_holiday" boolean DEFAULT false NOT NULL,
	"rate_cents" integer DEFAULT 0 NOT NULL,
	"rule_id" text NOT NULL,
	"reasons" json DEFAULT '[]'::json NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payroll_push" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"provider" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"status" text NOT NULL,
	"people" integer DEFAULT 0 NOT NULL,
	"request" json,
	"response" json,
	"error" text,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "care_types" ADD COLUMN "exclude_from_overtime" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "caregiver_profiles" ADD COLUMN "mileage_rate" numeric(5, 3);--> statement-breakpoint
ALTER TABLE "caregiver_profiles" ADD COLUMN "is_facility_staff" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "mileage_entries" ADD COLUMN "kind" text DEFAULT 'travel' NOT NULL;--> statement-breakpoint
ALTER TABLE "mileage_entries" ADD COLUMN "source" text DEFAULT 'entered' NOT NULL;--> statement-breakpoint
ALTER TABLE "mileage_entries" ADD COLUMN "review_id" text;--> statement-breakpoint
ALTER TABLE "payroll_shift_reviews" ADD COLUMN "travel_paid" boolean;--> statement-breakpoint
ALTER TABLE "payroll_shift_reviews" ADD COLUMN "travel_minutes" integer;--> statement-breakpoint
ALTER TABLE "payroll_shift_reviews" ADD COLUMN "travel_miles" numeric(7, 2);--> statement-breakpoint
ALTER TABLE "payroll_shift_reviews" ADD COLUMN "meal_break_minutes" integer;--> statement-breakpoint
ALTER TABLE "payroll_shift_reviews" ADD COLUMN "meal_waived" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_shift_reviews" ADD COLUMN "rest_break_missed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_shift_reviews" ADD COLUMN "is_sleepover" boolean DEFAULT false NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pay_hour_audit" ADD CONSTRAINT "pay_hour_audit_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pay_hour_audit" ADD CONSTRAINT "pay_hour_audit_caregiver_id_user_id_fk" FOREIGN KEY ("caregiver_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payroll_push" ADD CONSTRAINT "payroll_push_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payroll_push" ADD CONSTRAINT "payroll_push_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pay_hour_audit_company_id_idx" ON "pay_hour_audit" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pay_hour_audit_caregiver_period_idx" ON "pay_hour_audit" USING btree ("caregiver_id","period_start","period_end");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payroll_push_company_id_idx" ON "payroll_push" USING btree ("company_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mileage_entries" ADD CONSTRAINT "mileage_entries_review_id_payroll_shift_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."payroll_shift_reviews"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mileage_entries_review_idx" ON "mileage_entries" USING btree ("review_id");