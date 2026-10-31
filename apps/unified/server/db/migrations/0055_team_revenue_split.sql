ALTER TABLE "job" ADD COLUMN "revenue_split" json;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "salesperson_id" text;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "converted_at" timestamp;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "quote" ADD CONSTRAINT "quote_salesperson_id_user_id_fk" FOREIGN KEY ("salesperson_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quote_salesperson_idx" ON "quote" USING btree ("salesperson_id");--> statement-breakpoint
-- A quote that already became a job is dated by that job's creation (the earliest, when several came from it).
UPDATE "quote" q SET "converted_at" = m."at"
FROM (
  SELECT q2."id" AS "qid", MIN(j."created_at") AS "at"
  FROM "quote" q2 JOIN "job" j ON j."company_id" = q2."company_id" AND (j."id" = q2."converted_to_job_id" OR j."quote_id" = q2."id")
  GROUP BY q2."id"
) m
WHERE q."id" = m."qid" AND q."converted_at" IS NULL;
