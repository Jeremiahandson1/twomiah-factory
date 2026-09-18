-- Fix pre-existing schema drift: review_request was created (0000) without the
-- channel / clicked_at / follow_up_sent_at / review_link / job_id columns that
-- schema.ts declares, so any insert or processor run errored ("column
-- review_request.channel does not exist"). Backfill them idempotently.

ALTER TABLE "review_request" ADD COLUMN IF NOT EXISTS "channel" text DEFAULT 'both' NOT NULL;
--> statement-breakpoint
ALTER TABLE "review_request" ADD COLUMN IF NOT EXISTS "clicked_at" timestamp;
--> statement-breakpoint
ALTER TABLE "review_request" ADD COLUMN IF NOT EXISTS "follow_up_sent_at" timestamp;
--> statement-breakpoint
ALTER TABLE "review_request" ADD COLUMN IF NOT EXISTS "review_link" text;
--> statement-breakpoint
ALTER TABLE "review_request" ADD COLUMN IF NOT EXISTS "job_id" text;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "review_request" ADD CONSTRAINT "review_request_job_id_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "job"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "review_request_company_id_idx" ON "review_request" ("company_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "review_request_status_idx" ON "review_request" ("status");
