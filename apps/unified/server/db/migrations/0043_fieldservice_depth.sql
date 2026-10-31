CREATE TABLE IF NOT EXISTS "tech_hours" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"user_id" text,
	"member_id" text,
	"weekday" integer NOT NULL,
	"starts_at" text NOT NULL,
	"ends_at" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tech_time_off" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"user_id" text,
	"member_id" text,
	"starts_on" timestamp NOT NULL,
	"ends_on" timestamp NOT NULL,
	"start_time" text,
	"end_time" text,
	"note" text,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "form_submission" ADD COLUMN "signed_ip" text;--> statement-breakpoint
ALTER TABLE "form_submission" ADD COLUMN "signed_user_agent" text;--> statement-breakpoint
ALTER TABLE "form_submission" ADD COLUMN "signature_hash" text;--> statement-breakpoint
ALTER TABLE "form_submission" ADD COLUMN "consent_at" timestamp;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "created_by_id" text;--> statement-breakpoint
ALTER TABLE "quote_line_item" ADD COLUMN "option_group" text;--> statement-breakpoint
ALTER TABLE "time_entry" ADD COLUMN "clock_in_late_minutes" integer;--> statement-breakpoint
ALTER TABLE "time_entry" ADD COLUMN "clock_out_late_minutes" integer;--> statement-breakpoint
ALTER TABLE "service_agreement" ADD COLUMN "sold_by_id" text;--> statement-breakpoint
ALTER TABLE "service_agreement" ADD COLUMN "ended_at" timestamp;--> statement-breakpoint
ALTER TABLE "service_agreement" ADD COLUMN "ended_how" text;--> statement-breakpoint
ALTER TABLE "service_agreement" ADD COLUMN "cancel_reason" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tech_hours" ADD CONSTRAINT "tech_hours_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tech_hours" ADD CONSTRAINT "tech_hours_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tech_hours" ADD CONSTRAINT "tech_hours_member_id_team_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."team_member"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tech_time_off" ADD CONSTRAINT "tech_time_off_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tech_time_off" ADD CONSTRAINT "tech_time_off_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tech_time_off" ADD CONSTRAINT "tech_time_off_member_id_team_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."team_member"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tech_time_off" ADD CONSTRAINT "tech_time_off_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tech_hours_company_id_idx" ON "tech_hours" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tech_hours_user_weekday_key" ON "tech_hours" USING btree ("user_id","weekday");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tech_hours_member_weekday_key" ON "tech_hours" USING btree ("member_id","weekday");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tech_time_off_company_id_idx" ON "tech_time_off" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tech_time_off_user_idx" ON "tech_time_off" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tech_time_off_member_idx" ON "tech_time_off" USING btree ("member_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "quote" ADD CONSTRAINT "quote_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "service_agreement" ADD CONSTRAINT "service_agreement_sold_by_id_user_id_fk" FOREIGN KEY ("sold_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
