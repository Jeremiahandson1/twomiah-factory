-- The owner pays the bill, but the bill is FOR an animal. Invoices carried only the contact, so in a
-- multi-pet household nothing on the invoice said which pet the charges were for — and the chart could not
-- show what that animal had cost. (Vet T12 M6)
ALTER TABLE "invoice" ADD COLUMN IF NOT EXISTS "patient_id" text REFERENCES "patient"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "invoice_patient_id_idx" ON "invoice" ("patient_id");
