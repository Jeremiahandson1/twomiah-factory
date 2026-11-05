CREATE TABLE IF NOT EXISTS "agreement_event" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"agreement_id" text NOT NULL,
	"kind" text NOT NULL,
	"at" timestamp DEFAULT now() NOT NULL,
	"by_user_id" text,
	"note" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "saved_report" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"report" text NOT NULL,
	"name" text NOT NULL,
	"created_by_id" text,
	"params" json NOT NULL,
	"schedule" json,
	"last_sent_at" timestamp,
	"last_sent_for" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_call_session" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"call_log_id" text NOT NULL,
	"provider_call_id" text NOT NULL,
	"status" text DEFAULT 'live' NOT NULL,
	"outcome" text,
	"state" json NOT NULL,
	"job_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_call_turn" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"call_log_id" text NOT NULL,
	"seq" integer NOT NULL,
	"speaker" text NOT NULL,
	"text" text NOT NULL,
	"intent" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX IF EXISTS "tech_hours_user_weekday_key";--> statement-breakpoint
DROP INDEX IF EXISTS "tech_hours_member_weekday_key";--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN "job_reminders_off" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "service_agreement_id" text;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "paused_at" timestamp;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "revenue_split" json;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "confirmed_at" timestamp;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "confirmed_via" text;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "confirm_token" text;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "salesperson_id" text;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "converted_at" timestamp;--> statement-breakpoint
ALTER TABLE "quote_proposal_option" ADD COLUMN "set_index" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "quote_proposal_option" ADD COLUMN "set_name" text;--> statement-breakpoint
ALTER TABLE "quote_proposal_option" ADD COLUMN "set_kind" text DEFAULT 'one' NOT NULL;--> statement-breakpoint
ALTER TABLE "time_entry" ADD COLUMN "break_started_at" timestamp;--> statement-breakpoint
ALTER TABLE "time_entry" ADD COLUMN "break_minutes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "time_entry" ADD COLUMN "time_set_by_phone" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "time_entry" ADD COLUMN "clock_in_lat" real;--> statement-breakpoint
ALTER TABLE "time_entry" ADD COLUMN "clock_in_lng" real;--> statement-breakpoint
ALTER TABLE "time_entry" ADD COLUMN "clock_out_lat" real;--> statement-breakpoint
ALTER TABLE "time_entry" ADD COLUMN "clock_out_lng" real;--> statement-breakpoint
ALTER TABLE "time_entry" ADD COLUMN "clock_source" text;--> statement-breakpoint
ALTER TABLE "time_entry" ADD COLUMN "time_off_id" text;--> statement-breakpoint
ALTER TABLE "tech_hours" ADD COLUMN "kind" text DEFAULT 'regular' NOT NULL;--> statement-breakpoint
ALTER TABLE "tech_hours" ADD COLUMN "ends_next_day" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tech_hours" ADD COLUMN "starts_on" timestamp;--> statement-breakpoint
ALTER TABLE "tech_hours" ADD COLUMN "ends_on" timestamp;--> statement-breakpoint
ALTER TABLE "ai_receptionist_settings" ADD COLUMN "call_answering" json;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agreement_event" ADD CONSTRAINT "agreement_event_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agreement_event" ADD CONSTRAINT "agreement_event_agreement_id_service_agreement_id_fk" FOREIGN KEY ("agreement_id") REFERENCES "public"."service_agreement"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agreement_event" ADD CONSTRAINT "agreement_event_by_user_id_user_id_fk" FOREIGN KEY ("by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "saved_report" ADD CONSTRAINT "saved_report_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "saved_report" ADD CONSTRAINT "saved_report_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_call_session" ADD CONSTRAINT "ai_call_session_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_call_session" ADD CONSTRAINT "ai_call_session_call_log_id_call_log_id_fk" FOREIGN KEY ("call_log_id") REFERENCES "public"."call_log"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_call_session" ADD CONSTRAINT "ai_call_session_job_id_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_call_turn" ADD CONSTRAINT "ai_call_turn_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_call_turn" ADD CONSTRAINT "ai_call_turn_call_log_id_call_log_id_fk" FOREIGN KEY ("call_log_id") REFERENCES "public"."call_log"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agreement_event_agreement_idx" ON "agreement_event" USING btree ("agreement_id","at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agreement_event_company_kind_idx" ON "agreement_event" USING btree ("company_id","kind","at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "saved_report_company_idx" ON "saved_report" USING btree ("company_id","report");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_call_session_company_id_idx" ON "ai_call_session" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ai_call_session_provider_call_idx" ON "ai_call_session" USING btree ("company_id","provider_call_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_call_turn_call_log_id_idx" ON "ai_call_turn" USING btree ("call_log_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "quote" ADD CONSTRAINT "quote_salesperson_id_user_id_fk" FOREIGN KEY ("salesperson_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoice_service_agreement_idx" ON "invoice" USING btree ("service_agreement_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "job_confirm_token_idx" ON "job" USING btree ("confirm_token");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quote_salesperson_idx" ON "quote" USING btree ("salesperson_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "time_entry_time_off_idx" ON "time_entry" USING btree ("time_off_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tech_hours_user_idx" ON "tech_hours" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tech_hours_member_idx" ON "tech_hours" USING btree ("member_id");--> statement-breakpoint
-- Plans that already exist get the history their own dates can prove: when each was made, and when each ended. Renewals,
-- suspensions and reactivations before today were not recorded and are not invented; the plan reports count them from here on.
INSERT INTO "agreement_event" ("id", "company_id", "agreement_id", "kind", "at", "by_user_id")
SELECT 'bk' || md5(a."id" || ':created'), a."company_id", a."id", 'created', a."created_at", a."sold_by_id" FROM "service_agreement" a
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
INSERT INTO "agreement_event" ("id", "company_id", "agreement_id", "kind", "at")
SELECT 'bk' || md5(a."id" || ':ended'), a."company_id", a."id",
       CASE WHEN a."ended_how" = 'expired' OR (a."ended_how" IS NULL AND a."status" = 'expired') THEN 'expired' ELSE 'cancelled' END,
       COALESCE(a."ended_at", a."updated_at")
FROM "service_agreement" a WHERE a."status" IN ('cancelled', 'expired')
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
-- A plan's invoices were not linked to it. The ones billing wrote carry the plan's name in their line ("<name> - <frequency> billing")
-- and go to the plan's customer, so those are linked now; any invoice that matches no plan stays unlinked.
UPDATE "invoice" i SET "service_agreement_id" = m."agr"
FROM (
  SELECT DISTINCT ON (li."invoice_id") li."invoice_id" AS "inv", a."id" AS "agr"
  FROM "invoice_line_item" li
  JOIN "invoice" iv ON iv."id" = li."invoice_id"
  JOIN "service_agreement" a ON a."company_id" = iv."company_id" AND a."contact_id" = iv."contact_id"
       AND li."description" = a."name" || ' - ' || a."billing_frequency" || ' billing'
  ORDER BY li."invoice_id", a."created_at", a."id"
) m
WHERE i."id" = m."inv" AND i."service_agreement_id" IS NULL;--> statement-breakpoint
-- A quote that already became a job is dated by that job's creation (the earliest, when several came from it).
UPDATE "quote" q SET "converted_at" = m."at"
FROM (
  SELECT q2."id" AS "qid", MIN(j."created_at") AS "at"
  FROM "quote" q2 JOIN "job" j ON j."company_id" = q2."company_id" AND (j."id" = q2."converted_to_job_id" OR j."quote_id" = q2."id")
  GROUP BY q2."id"
) m
WHERE q."id" = m."qid" AND q."converted_at" IS NULL;