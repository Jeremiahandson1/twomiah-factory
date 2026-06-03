-- Fix: job_photo is defined in schema.ts and used by seed.template.ts but was
-- never created by the base (0000) migration in the crm-fieldservice lineage.
CREATE TABLE IF NOT EXISTS "job_photo" (
  "id" text PRIMARY KEY NOT NULL,
  "company_id" text NOT NULL,
  "job_id" text NOT NULL,
  "uploaded_by_id" text,
  "url" text NOT NULL,
  "thumbnail_url" text,
  "caption" text,
  "taken_at" timestamp DEFAULT now() NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "job_photo_company_id_idx" ON "job_photo" ("company_id");
CREATE INDEX IF NOT EXISTS "job_photo_job_id_idx" ON "job_photo" ("job_id");
