-- A bid becomes work, and it was a dead end. (T32 H6)
--
-- `bid` had no link to anything: the client was free text, and winning one left you retyping the
-- project name, the client and the value into the Projects screen by hand. The report looked for the
-- conversion and found convert / convert-to-job / create-job all 404.
--
-- contact_id  — who the bid is for, when they are already a contact. `client` STAYS as free text and
--               is not replaced: a contractor bids work for people who are not customers yet, and
--               forcing a contact record before you can log a bid would be the wrong trade. The
--               contact is what gets carried over on conversion when it is there.
-- project_id  — what this bid BECAME. It makes the conversion idempotent: a won bid converts once,
--               and clicking twice returns the project that already exists instead of making a
--               second one (the fault T32 H3 found in selections, which raised five change orders
--               for one decision).
ALTER TABLE "bid" ADD COLUMN IF NOT EXISTS "contact_id" text;
ALTER TABLE "bid" ADD COLUMN IF NOT EXISTS "project_id" text;

DO $$ BEGIN
  ALTER TABLE "bid" ADD CONSTRAINT "bid_contact_id_contact_id_fk"
    FOREIGN KEY ("contact_id") REFERENCES "contact"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "bid" ADD CONSTRAINT "bid_project_id_project_id_fk"
    FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "bid_contact_id_idx" ON "bid" ("contact_id");
CREATE INDEX IF NOT EXISTS "bid_project_id_idx" ON "bid" ("project_id");
