-- A training with an expiry date (a CPR card) is also a credential (crm/homecare/hr/shared.ts trainingAsCredential): the trainings
-- recorded before that rule get their credential once, so the Credentials page, the expiring-soon list and the reminders see them
-- (home care live re-check 11/08: "No credentials match." beside a CPR certificate expiring in three weeks).
INSERT INTO "certification_records" ("id", "company_id", "caregiver_id", "certification_type", "issuing_body", "issue_date", "expiry_date", "certification_number", "status")
SELECT gen_random_uuid()::text, t."company_id", t."caregiver_id", t."training_name", t."provider", t."completed_date", t."expiry_date", t."certification_number", 'active'
  FROM "training_records" t
 WHERE t."expiry_date" IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM "certification_records" c
      WHERE c."company_id" = t."company_id" AND c."caregiver_id" = t."caregiver_id"
        AND c."certification_type" = t."training_name" AND c."expiry_date" = t."expiry_date");
