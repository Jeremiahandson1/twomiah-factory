-- Wellness plans are the practice's only recurring revenue line and they billed nothing: an enrolment stored a
-- billing cycle, raised no invoice and scheduled no renewal. These two columns make the billing idempotent —
-- last_billed_for is the period already invoiced, so a retry (or two requests at once) cannot bill twice.
-- (Vet T12 H3)
ALTER TABLE "wellness_enrollment" ADD COLUMN IF NOT EXISTS "last_billed_for" date;
ALTER TABLE "wellness_enrollment" ADD COLUMN IF NOT EXISTS "last_invoice_id" text REFERENCES "invoice"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "wellness_enrollment_renews_at_idx" ON "wellness_enrollment" ("renews_at");
