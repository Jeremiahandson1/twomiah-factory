-- Job photos. Was added to schema.ts but no migration was generated for it
-- until 2026-06-04 — fieldservice deploys consistently crashed on first
-- boot because seed.template.ts queries jobPhoto before any later migration
-- could create the table. Discovered via the test harness's Render log
-- capture (smoke v6, test 002).

CREATE TABLE IF NOT EXISTS "job_photo" (
  "id" text PRIMARY KEY NOT NULL,
  "company_id" text NOT NULL,
  "job_id" text NOT NULL,
  "uploaded_by_id" text,
  "url" text NOT NULL,
  "thumbnail_url" text,
  "caption" text,
  "taken_at" timestamp DEFAULT now() NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "job_photo_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "job_photo_job_id_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "job"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "job_photo_uploaded_by_id_user_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "user"("id") ON DELETE set null ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_photo_company_id_idx" ON "job_photo" ("company_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_photo_job_id_idx" ON "job_photo" ("job_id");
