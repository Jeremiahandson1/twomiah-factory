-- A file belongs to the animal, not to the person who pays the bill. Documents could only be filed under an
-- owner, so in a two-pet household an x-ray, a referral letter or a vaccination certificate landed in a pile
-- with no way to tell whose it was — and the patient chart had nowhere to show it. (Vet T12 M6)
ALTER TABLE "document" ADD COLUMN IF NOT EXISTS "patient_id" text REFERENCES "patient"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "document_patient_id_idx" ON "document" ("patient_id");
