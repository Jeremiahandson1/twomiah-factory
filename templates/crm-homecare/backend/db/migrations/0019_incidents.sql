-- Incident case file (ported from CVHC migrations v64 + v68).
--
-- An incident was one short row with add/delete only; the investigation, the payer's
-- requested documents and the schedule action all lived outside the CRM. This adds the
-- case file: a stable printed number, case status, reporter contact, payer response
-- due/sent dates, the conclusion and findings, the mandatory-report decision, a note
-- printed in the payer response letter, the reversible "caregiver removed from this
-- client pending investigation", and a signed training acknowledgement; plus a dated
-- investigation timeline and attachments.
--
-- Columns the template already had are used, not duplicated:
--   CVHC incident_date       -> incidents.date
--   CVHC status              -> incidents.investigation_status
--   CVHC actions_taken       -> incidents.action_taken
--   CVHC reported_by_user_id -> incidents.reported_by_id
--   CVHC closed_date         -> incidents.resolved_at (the date, at midnight) + resolved_by_id
--
-- Additive except for two value maps on existing rows (severity and status), so every
-- old row reads in the new vocabulary. No column is dropped or retyped.
ALTER TABLE "incidents" ADD COLUMN IF NOT EXISTS "incident_number" text;
--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN IF NOT EXISTS "incident_time" time;
--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN IF NOT EXISTS "follow_up_notes" text;
--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN IF NOT EXISTS "reported_by" text;
--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN IF NOT EXISTS "reported_date" date;
--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN IF NOT EXISTS "reporter_contact_name" text;
--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN IF NOT EXISTS "reporter_phone" text;
--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN IF NOT EXISTS "reporter_email" text;
--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN IF NOT EXISTS "response_due_date" date;
--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN IF NOT EXISTS "response_sent_date" date;
--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN IF NOT EXISTS "disposition" text;
--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN IF NOT EXISTS "findings" text;
--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN IF NOT EXISTS "mandatory_report_status" text;
--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN IF NOT EXISTS "mandatory_report_details" text;
--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN IF NOT EXISTS "payer_response_notes" text;
--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN IF NOT EXISTS "caregiver_removed_from" date;
--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN IF NOT EXISTS "caregiver_returned_on" date;
--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN IF NOT EXISTS "caregiver_removal" json;
--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN IF NOT EXISTS "training_ack_signed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN IF NOT EXISTS "training_ack_signer_name" text;
--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN IF NOT EXISTS "training_ack_signature" text;
--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN IF NOT EXISTS "training_ack_supervisor" text;
--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN IF NOT EXISTS "training_ack_method" text;
--> statement-breakpoint
-- Severity: the old API defaulted to 'low'; the case file speaks minor/moderate/severe/critical.
UPDATE "incidents" SET "severity" = CASE "severity"
    WHEN 'low' THEN 'minor' WHEN 'medium' THEN 'moderate' WHEN 'high' THEN 'severe' ELSE "severity" END
  WHERE "severity" IN ('low', 'medium', 'high');
--> statement-breakpoint
ALTER TABLE "incidents" ALTER COLUMN "severity" SET DEFAULT 'moderate';
--> statement-breakpoint
-- Status: open | investigating | closed.
UPDATE "incidents" SET "investigation_status" = CASE
    WHEN "investigation_status" IN ('resolved', 'closed', 'complete', 'completed') THEN 'closed'
    WHEN "investigation_status" IN ('in_progress', 'under_investigation', 'investigating', 'pending') THEN 'investigating'
    ELSE 'open' END
  WHERE "investigation_status" IS NULL OR "investigation_status" NOT IN ('open', 'investigating', 'closed');
--> statement-breakpoint
-- Stable printed number IR-<year>-<nnn> for existing rows, in creation order within each incident year.
UPDATE "incidents" i
   SET "incident_number" = n.num
  FROM (SELECT id,
               'IR-' || EXTRACT(YEAR FROM COALESCE("date", created_at::date))::int || '-' ||
               lpad(ROW_NUMBER() OVER (PARTITION BY EXTRACT(YEAR FROM COALESCE("date", created_at::date))
                                       ORDER BY created_at, id)::text, 3, '0') AS num
          FROM "incidents") n
 WHERE n.id = i.id AND i."incident_number" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "incidents_incident_number_idx" ON "incidents" ("incident_number");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "incidents_response_due_idx" ON "incidents" ("response_due_date");
--> statement-breakpoint
-- Per-year high-water mark: the next number is always above every number ever issued,
-- including ones whose incident was later deleted.
CREATE TABLE IF NOT EXISTS "incident_number_counters" (
  "year" integer PRIMARY KEY NOT NULL,
  "last_number" integer NOT NULL
);
--> statement-breakpoint
INSERT INTO "incident_number_counters" ("year", "last_number")
SELECT split_part("incident_number", '-', 2)::int, MAX(split_part("incident_number", '-', 3)::int)
  FROM "incidents"
 WHERE "incident_number" ~ '^IR-[0-9]{4}-[0-9]+$'
 GROUP BY 1
ON CONFLICT ("year") DO UPDATE SET "last_number" = GREATEST("incident_number_counters"."last_number", EXCLUDED."last_number");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "incident_investigation_notes" (
  "id" text PRIMARY KEY NOT NULL,
  "incident_id" text NOT NULL,
  "entry_date" date NOT NULL,
  "entry_type" text DEFAULT 'note' NOT NULL,
  "summary" text NOT NULL,
  "created_by_id" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "incident_investigation_notes" ADD CONSTRAINT "incident_investigation_notes_incident_id_incidents_id_fk"
    FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "incident_investigation_notes" ADD CONSTRAINT "incident_investigation_notes_created_by_id_users_id_fk"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "incident_investigation_notes_incident_idx" ON "incident_investigation_notes" ("incident_id", "entry_date");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "incident_attachments" (
  "id" text PRIMARY KEY NOT NULL,
  "incident_id" text NOT NULL,
  "category" text DEFAULT 'other' NOT NULL,
  "file_name" text NOT NULL,
  "mime_type" text NOT NULL,
  "file_size" integer,
  "file_data" text NOT NULL,
  "description" text,
  "uploaded_by_id" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "incident_attachments" ADD CONSTRAINT "incident_attachments_incident_id_incidents_id_fk"
    FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "incident_attachments" ADD CONSTRAINT "incident_attachments_uploaded_by_id_users_id_fk"
    FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "incident_attachments_incident_idx" ON "incident_attachments" ("incident_id", "created_at");
