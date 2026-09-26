-- Add all columns from schema.ts missing in the initial service_agreement migration
ALTER TABLE "service_agreement" ADD COLUMN IF NOT EXISTS "recurrence_rule" json;
ALTER TABLE "service_agreement" ADD COLUMN IF NOT EXISTS "next_service_date" timestamp;
ALTER TABLE "service_agreement" ADD COLUMN IF NOT EXISTS "auto_schedule" boolean DEFAULT false NOT NULL;
ALTER TABLE "service_agreement" ADD COLUMN IF NOT EXISTS "reminder_days_before" integer DEFAULT 7 NOT NULL;
ALTER TABLE "service_agreement" ADD COLUMN IF NOT EXISTS "last_generated_job_id" text;
