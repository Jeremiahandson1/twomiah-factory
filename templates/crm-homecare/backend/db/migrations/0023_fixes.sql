-- Home care catch-up, fixes after the merge.
--
-- clients.medical_notes / clients.care_preferences: the Edit Client form's "Medical notes" and
-- "Care preferences" boxes, and the caregiver's client card (GET /api/clients/:id/caregiver-view).
-- The source CRM's columns (its migration_v14). 0005 already added them on some databases, so these
-- are IF NOT EXISTS; until now schema.ts did not hold them and nothing saved into them.
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "medical_notes" text;
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "care_preferences" text;
--> statement-breakpoint
-- agencies.mileage_rate: the agency's mileage reimbursement per mile. A caregiver's trip is always
-- paid at this rate (POST /api/mileage ignores a rate a caregiver sends); the office may still set
-- one per trip. $0.67 was the rate hard-coded before.
ALTER TABLE "agencies" ADD COLUMN IF NOT EXISTS "mileage_rate" numeric(6, 3) DEFAULT 0.67 NOT NULL;
