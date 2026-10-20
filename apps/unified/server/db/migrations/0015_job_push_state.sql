CREATE TABLE IF NOT EXISTS "job_push_state" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"assignee_id" text,
	"scheduled_for" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "job_push_state" ADD CONSTRAINT "job_push_state_job_id_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "job_push_state_job_id_idx" ON "job_push_state" USING btree ("job_id");--> statement-breakpoint
-- Every job that exists now counts as already announced: only work assigned or rescheduled from here on notifies.
-- scheduled_for is the expression data/phonePush.ts SCHEDULED_FOR uses (apps/unified/tests/phone-push.test.ts holds the
-- two equal). The row id is the job's, prefixed: unique because the job's is.
INSERT INTO "job_push_state" ("id", "job_id", "assignee_id", "scheduled_for")
SELECT 'jps_' || "id", "id", "assigned_to_id", CASE WHEN "scheduled_date" IS NULL THEN NULL ELSE to_char("scheduled_date", 'YYYY-MM-DD') || COALESCE(' ' || NULLIF("scheduled_time", ''), '') END
FROM "job"
ON CONFLICT ("job_id") DO NOTHING;
