-- An invoice can be raised FOR A JOB, and says which. (T41)
--
-- There was no way to bill a service call. A quote converts to an invoice and a quote converts to a
-- job, but a job — which is what a field-service business actually does all day, and which often
-- exists with no quote at all behind it — had no billing path. The only route was to create an
-- invoice by hand and pick the customer, and that invoice then belonged to nothing:
--
--   · the job showed its cost (time, parts, expenses) with NO revenue against it, because job
--     costing attributes revenue through invoice.quote_id and invoice.project_id and a hand-made
--     invoice has neither — so a completed, invoiced, paid job read as a pure loss, and the
--     margin for the month was wrong by the value of every call billed that way;
--   · nothing on the job linked to the money, so nobody could tell whether it had been billed.
--
-- UNIQUE, deliberately. One job bills once. The route takes a row lock and re-checks inside it, and
-- this index is the backstop under that — the same belt-and-braces the T41 bill-once work put on
-- visits and quotes, where two clicks on one button raised two invoices for the same work.
-- A partial index, so the many invoices with no job at all do not collide with each other.
ALTER TABLE "invoice" ADD COLUMN IF NOT EXISTS "job_id" text;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "invoice" ADD CONSTRAINT "invoice_job_id_fk"
    FOREIGN KEY ("job_id") REFERENCES "job"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "invoice_job_id_unique_idx" ON "invoice" ("job_id") WHERE "job_id" IS NOT NULL;
