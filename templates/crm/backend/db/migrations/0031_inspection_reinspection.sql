-- A re-inspection is a NEW record, not an overwritten one. (T32 M1)
--
-- The report failed INS-0001 and then passed it. The pass overwrote the failure in place: status
-- failed → passed, result fail → pass, and the deficiencies gone. So an inspection that a building
-- inspector had failed read as if it had passed first time, with nothing anywhere to say otherwise.
--
-- On a construction job that record is the evidence. A failed inspection is a fact about a date, and
-- the re-visit is a second fact about a second date — which is why it needs a second row, and why
-- that row has to say which inspection it is re-doing.
ALTER TABLE "inspection" ADD COLUMN IF NOT EXISTS "reinspection_of_id" text;

DO $$ BEGIN
  ALTER TABLE "inspection"
    ADD CONSTRAINT "inspection_reinspection_of_id_inspection_id_fk"
    FOREIGN KEY ("reinspection_of_id") REFERENCES "inspection"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "inspection_reinspection_of_id_idx" ON "inspection" ("reinspection_of_id");

-- Who recorded the result, and when. `result` said pass or fail and nothing said who decided or on
-- what day — so a failure could not be told from a failure recorded a week late.
ALTER TABLE "inspection" ADD COLUMN IF NOT EXISTS "resulted_at" timestamp;
ALTER TABLE "inspection" ADD COLUMN IF NOT EXISTS "resulted_by" text;
