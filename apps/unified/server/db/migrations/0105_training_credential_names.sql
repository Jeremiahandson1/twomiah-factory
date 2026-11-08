-- A training's credential copy carries the training's name as people read it ("CPR Certification", not the code "cpr") —
-- crm/homecare/hr/shared.ts trainingLabel (home care re-check 2, 11/08: Credentials and the expiry notice said "cpr").
-- The copies already made (0104 and since) are renamed; a credential typed in by hand is never one of these codes.
UPDATE "certification_records" c
   SET "certification_type" = CASE c."certification_type"
    WHEN 'cpr' THEN 'CPR Certification'
    WHEN 'first_aid' THEN 'First Aid'
    WHEN 'hipaa' THEN 'HIPAA Training'
    WHEN 'infection_control' THEN 'Infection Control'
    WHEN 'bloodborne_pathogen' THEN 'Bloodborne Pathogen'
    WHEN 'safety' THEN 'Workplace Safety'
    WHEN 'dementia_care' THEN 'Dementia Care'
    WHEN 'fall_prevention' THEN 'Fall Prevention'
    WHEN 'manual_handling' THEN 'Manual Handling'
    WHEN 'medication_administration' THEN 'Medication Administration'
    WHEN 'medication_reminders' THEN 'Medication Reminders & Handling (PCW)'
    WHEN 'misappropriation_policy' THEN 'Client Funds, Property & Misappropriation Policy'
   END
 WHERE c."certification_type" IN ('cpr', 'first_aid', 'hipaa', 'infection_control', 'bloodborne_pathogen', 'safety', 'dementia_care', 'fall_prevention', 'manual_handling', 'medication_administration', 'medication_reminders', 'misappropriation_policy')
   AND EXISTS (SELECT 1 FROM "training_records" t WHERE t."company_id" = c."company_id" AND t."caregiver_id" = c."caregiver_id"
                 AND t."training_name" = c."certification_type" AND t."expiry_date" = c."expiry_date");
