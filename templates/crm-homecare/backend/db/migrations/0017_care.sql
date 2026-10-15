-- Care: the clinical side of a visit, brought up to the source home care CRM.
--
--   * care task checklists per client (what the caregiver does each shift), with the weekly
--     assessment fields an insurer's assessment carries (x/week, minutes/task, days, AM/PM)
--     and a daily-vs-weekly cadence; and the per-shift completion log
--   * care plans: the five note sections the screen already asked for but the table never held,
--     the visit schedule as it stood when the plan was saved, and a revision snapshot of the OLD
--     row on every change (a trigger, so every update path is covered)
--   * care plan templates, with a starter pack of six
--   * vitals per visit, with plausible-range checks
--   * MAR: the medication log gets its visit, scheduled time, dose given, witness and the strict
--     status (given / refused / held / self_administered / missed)
--   * a real document store (the Documents screen called routes that did not exist) with
--     e-signature: the latest signature on the row and every signature in a history table
--   * the form library: built-in templates, one of them Wisconsin-only (state = 'WI')
--   * insurance card photos on the client
--   * ADL logs linked to the visit they were recorded on
--
-- Additive only. Every statement is IF NOT EXISTS / idempotent.

CREATE TABLE IF NOT EXISTS "client_task_templates" (
  "id" text PRIMARY KEY NOT NULL,
  "client_id" text NOT NULL,
  "task_name" text NOT NULL,
  "description" text,
  "category" text DEFAULT 'other' NOT NULL,
  "allotted_minutes" integer DEFAULT 0 NOT NULL,
  "weekly_frequency" integer DEFAULT 1 NOT NULL,
  "days_of_week" text,
  "time_of_day" text DEFAULT 'any' NOT NULL,
  "assessment_source" text,
  "cadence" text DEFAULT 'daily' NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_by_id" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "client_task_templates_category_check" CHECK ("category" IN ('adl','iadl','medication','companion','safety','other')),
  CONSTRAINT "client_task_templates_time_of_day_check" CHECK ("time_of_day" IN ('AM','PM','any')),
  CONSTRAINT "client_task_templates_cadence_check" CHECK ("cadence" IN ('daily','weekly'))
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "client_task_templates" ADD CONSTRAINT "client_task_templates_client_id_clients_id_fk"
    FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "client_task_templates" ADD CONSTRAINT "client_task_templates_created_by_id_users_id_fk"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id");
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_task_templates_client_active_idx" ON "client_task_templates" ("client_id", "is_active");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "shift_task_completions" (
  "id" text PRIMARY KEY NOT NULL,
  "time_entry_id" text NOT NULL,
  "task_template_id" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "notes" text,
  "completed_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "shift_task_completions_status_check" CHECK ("status" IN ('pending','completed','skipped','refused'))
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "shift_task_completions" ADD CONSTRAINT "shift_task_completions_time_entry_id_time_entries_id_fk"
    FOREIGN KEY ("time_entry_id") REFERENCES "time_entries"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "shift_task_completions" ADD CONSTRAINT "shift_task_completions_task_template_id_client_task_templates_id_fk"
    FOREIGN KEY ("task_template_id") REFERENCES "client_task_templates"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "shift_task_completions_entry_task_idx" ON "shift_task_completions" ("time_entry_id", "task_template_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shift_task_completions_time_entry_idx" ON "shift_task_completions" ("time_entry_id");
--> statement-breakpoint

-- ── care plans ───────────────────────────────────────────────────────────────
ALTER TABLE "care_plans" ADD COLUMN IF NOT EXISTS "service_description" text;
--> statement-breakpoint
ALTER TABLE "care_plans" ADD COLUMN IF NOT EXISTS "medication_notes" text;
--> statement-breakpoint
ALTER TABLE "care_plans" ADD COLUMN IF NOT EXISTS "mobility_notes" text;
--> statement-breakpoint
ALTER TABLE "care_plans" ADD COLUMN IF NOT EXISTS "dietary_notes" text;
--> statement-breakpoint
ALTER TABLE "care_plans" ADD COLUMN IF NOT EXISTS "communication_notes" text;
--> statement-breakpoint
ALTER TABLE "care_plans" ADD COLUMN IF NOT EXISTS "visit_schedule" text;
--> statement-breakpoint
ALTER TABLE "care_plans" ADD COLUMN IF NOT EXISTS "visit_schedule_as_of" date;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "care_plan_templates" (
  "id" text PRIMARY KEY NOT NULL,
  "template_name" text NOT NULL,
  "template_description" text,
  "category" text,
  "service_type" text,
  "service_description" text,
  "frequency" text,
  "care_goals" text,
  "special_instructions" text,
  "precautions" text,
  "medication_notes" text,
  "mobility_notes" text,
  "dietary_notes" text,
  "communication_notes" text,
  "is_built_in" boolean DEFAULT false NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_by_id" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "care_plan_templates" ADD CONSTRAINT "care_plan_templates_created_by_id_users_id_fk"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id");
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "care_plan_templates_active_idx" ON "care_plan_templates" ("is_active");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "care_plan_templates_category_idx" ON "care_plan_templates" ("category");
--> statement-breakpoint
-- Starter pack. service_type uses the care plan screen's own values so a plan made from a
-- template shows its service label. Never re-seeded once any built-in exists.
INSERT INTO "care_plan_templates"
  ("id", "template_name", "template_description", "category", "service_type", "frequency", "care_goals", "special_instructions", "precautions", "medication_notes", "mobility_notes", "dietary_notes", "communication_notes", "is_built_in")
SELECT gen_random_uuid()::text, t.* FROM (VALUES
  (
    'Personal Care — Independent Adult', 'Bathing, grooming, dressing assistance for a mostly-independent client.',
    'personal_care', 'personal_care', 'Weekly visits',
    E'Maintain personal hygiene and grooming\nPromote dignity and independence\nMonitor skin integrity',
    E'Allow client to perform tasks they can manage independently — supervise only.\nOffer choices (e.g., shower vs. bath, time of day) to preserve autonomy.',
    E'Watch for skin breakdown around bony prominences.\nReport any falls, bruising, or skin changes.',
    'Refer to medication list. Caregiver may remind but not administer unless trained and authorized.',
    'Ambulatory. Stand-by assistance only — no transfer required unless noted.',
    'Regular diet. Encourage hydration (8 cups water/day).',
    'Speak clearly, face client. No known communication barriers.',
    true
  ),
  (
    'Dementia / Alzheimer''s Care', 'For clients with moderate cognitive decline. Focus on routine, safety, validation.',
    'dementia_care', 'personal_care', 'Daily visits, same caregiver preferred',
    E'Maintain consistent daily routine\nMinimize agitation and confusion\nEnsure home safety (no wandering, no falls)\nProvide cognitive engagement',
    E'Same caregiver visits each day if possible — continuity reduces anxiety.\nUse validation therapy, not correction. Do not argue about misremembered facts.\nRedirect rather than refuse.\nKeep environment calm: low noise, soft lighting in evening.\nFollow consistent meal/activity/bedtime schedule.',
    E'Wandering risk — verify all doors locked before leaving.\nFall risk — clear pathways, remove throw rugs.\nDo not leave client alone with stove on.\nReport any new agitation, paranoia, or refusal of care.',
    'Caregiver to remind only. Family/RN administers. Watch for medication refusal — common in dementia.',
    'Stand-by to minimal assist. Gait may be unsteady — encourage cane/walker use.',
    'Soft/easy-chew foods preferred if dental issues. Hydrate often — dementia clients often forget to drink.',
    'Speak slowly, one short sentence at a time. Use name. Make eye contact. Avoid open-ended questions; offer simple choices.',
    true
  ),
  (
    'Post-Surgical Recovery (Hip/Knee)', 'Short-term recovery support after orthopedic surgery.',
    'post_surgical', 'personal_care', 'Daily for first 2 weeks, then PRN',
    E'Promote safe healing per surgeon''s instructions\nPrevent falls and re-injury\nManage pain comfort\nAssist with prescribed PT exercises',
    E'Follow weight-bearing restrictions exactly as ordered (TDWB / PWB / FWB).\nAssist with home exercise program — 2x/day at minimum.\nIce 15-20 min after PT exercises.\nElevate surgical leg when resting.',
    E'Watch surgical incision for redness, drainage, swelling — report to RN immediately.\nDVT/PE warning signs: calf pain/swelling, sudden shortness of breath — 911.\nDo NOT bend hip past 90°, cross legs, or twist (hip clients).',
    'Pain meds usually scheduled. Anticoagulant (e.g., Lovenox, Eliquis) common — watch for bruising/bleeding.',
    'Use walker for all transfers. Caregiver provides stand-by assist. No bending below knee level (hip restrictions).',
    'Regular diet. Encourage protein for tissue repair. Hydrate well — anesthesia + opioids cause constipation.',
    'Alert and oriented. Communicate any new pain, fever, or changes promptly.',
    true
  ),
  (
    'Companion Care', 'Social engagement, light housekeeping, errands. No personal care needs.',
    'companion', 'companionship', 'Flexible schedule',
    E'Reduce isolation through social interaction\nMaintain a safe, clean home environment\nAssist with errands and appointments',
    E'Activities client enjoys: reading aloud, cards, light walks, music, reminiscing.\nLight housekeeping: dishes, laundry, dusting, sweeping.\nMeal prep encouraged — eat together when possible.',
    'No major safety concerns. Maintain situational awareness during community outings.',
    'Self-administered. Caregiver does not handle medications.',
    'Independent. Stand-by during community outings.',
    'Per client preference.',
    'Engaged conversationalist. Respect privacy on sensitive topics.',
    true
  ),
  (
    'Diabetes Management Support', 'For diabetic clients needing meal/medication reminders and blood-sugar monitoring.',
    'chronic_condition', 'personal_care', 'Daily visits, meal-time aligned',
    E'Maintain stable blood glucose\nSupport diabetic diet adherence\nMonitor for signs of hypo/hyperglycemia\nFoot/skin daily check',
    E'Remind client to check blood sugar per RN schedule.\nLog readings in care notes.\nDaily foot inspection — report any wound, redness, or sensation change immediately.\nEnsure client eats consistent carb portions at consistent times.',
    E'HYPOGLYCEMIA (BG < 70): glucose tabs/juice, recheck in 15 min, call RN if not resolved.\nHYPERGLYCEMIA (BG > 300, fruity breath, confusion): 911.\nAny foot wound that doesn''t heal in 48h: notify RN.',
    'Insulin / oral hypoglycemics. Caregiver reminds; trained/authorized caregivers may administer per care plan.',
    'Ambulatory. Avoid hot water for foot soaks (risk of burns with reduced sensation).',
    'Diabetic / consistent-carb diet. Low sodium if also hypertensive. Limit concentrated sweets.',
    'Alert. Watch for confusion or sluggishness — could indicate blood-sugar swing.',
    true
  ),
  (
    'End of Life / Hospice Support', 'Comfort care for terminally ill clients. Comply with hospice plan of care.',
    'hospice', 'personal_care', 'Daily, hours per hospice order',
    E'Maximize comfort and dignity\nSupport client and family emotionally\nFollow hospice plan of care exactly',
    E'Hospice nurse is lead. Caregiver supports, does not direct.\nGentle repositioning q2h to prevent skin breakdown.\nMouth care every 2 hours — terminal dehydration causes dry mouth.\nFamily presence is comforting — do not interrupt unless asked.\nPlay favorite music, read aloud, hold hand. Hearing is the last sense to go.',
    E'Do NOT call 911 for expected death — call hospice nurse first.\nDo not force food/water — terminal anorexia is natural and not painful.\nAny pain or distress: notify hospice immediately.',
    'Comfort meds (morphine, lorazepam, atropine) per hospice. Administered by hospice/family. Caregiver may remind/assist per training.',
    'Bed-bound likely. Two-person transfer if any. Use draw sheet to reposition.',
    'Offer small sips/ice chips per tolerance. Do not pressure intake.',
    'May be non-verbal. Continue to speak to client. Identify self when entering room.',
    true
  )
) AS t(template_name, template_description, category, service_type, frequency, care_goals, special_instructions, precautions, medication_notes, mobility_notes, dietary_notes, communication_notes, is_built_in)
WHERE NOT EXISTS (SELECT 1 FROM "care_plan_templates" WHERE "is_built_in" = true);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "care_plan_revisions" (
  "id" text PRIMARY KEY NOT NULL,
  "care_plan_id" text NOT NULL,
  "revision_number" integer NOT NULL,
  "changed_at" timestamp DEFAULT now() NOT NULL,
  "changed_by_id" text,
  "service_type" text,
  "service_description" text,
  "frequency" text,
  "care_goals" text,
  "special_instructions" text,
  "precautions" text,
  "medication_notes" text,
  "mobility_notes" text,
  "dietary_notes" text,
  "communication_notes" text,
  "start_date" date,
  "end_date" date,
  "status" text,
  "visit_schedule" text,
  "visit_schedule_as_of" date
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "care_plan_revisions" ADD CONSTRAINT "care_plan_revisions_care_plan_id_care_plans_id_fk"
    FOREIGN KEY ("care_plan_id") REFERENCES "care_plans"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "care_plan_revisions_plan_rev_idx" ON "care_plan_revisions" ("care_plan_id", "revision_number");
--> statement-breakpoint
-- Snapshot the OLD row on every UPDATE that changes plan content. changed_by_id comes from a
-- transaction-local setting the API sets on the same connection as its UPDATE (crm.user_id);
-- any other update path records the change with no author rather than not at all.
CREATE OR REPLACE FUNCTION snapshot_care_plan_on_update()
RETURNS TRIGGER AS $$
DECLARE
  next_rev INTEGER;
  by_id TEXT;
BEGIN
  SELECT COALESCE(MAX(revision_number), 0) + 1 INTO next_rev
    FROM care_plan_revisions WHERE care_plan_id = OLD.id;
  by_id := NULLIF(current_setting('crm.user_id', true), '');
  INSERT INTO care_plan_revisions (
    id, care_plan_id, revision_number, changed_by_id,
    service_type, service_description, frequency,
    care_goals, special_instructions, precautions,
    medication_notes, mobility_notes, dietary_notes,
    communication_notes, start_date, end_date, status,
    visit_schedule, visit_schedule_as_of
  ) VALUES (
    gen_random_uuid()::text, OLD.id, next_rev, by_id,
    OLD.service_type, OLD.service_description, OLD.frequency,
    OLD.care_goals, OLD.special_instructions, OLD.precautions,
    OLD.medication_notes, OLD.mobility_notes, OLD.dietary_notes,
    OLD.communication_notes, OLD.start_date, OLD.end_date, OLD.status,
    OLD.visit_schedule, OLD.visit_schedule_as_of
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "trg_snapshot_care_plan" ON "care_plans";
--> statement-breakpoint
CREATE TRIGGER "trg_snapshot_care_plan"
  BEFORE UPDATE ON "care_plans"
  FOR EACH ROW
  WHEN (
    OLD.service_type IS DISTINCT FROM NEW.service_type
    OR OLD.service_description IS DISTINCT FROM NEW.service_description
    OR OLD.frequency IS DISTINCT FROM NEW.frequency
    OR OLD.care_goals IS DISTINCT FROM NEW.care_goals
    OR OLD.special_instructions IS DISTINCT FROM NEW.special_instructions
    OR OLD.precautions IS DISTINCT FROM NEW.precautions
    OR OLD.medication_notes IS DISTINCT FROM NEW.medication_notes
    OR OLD.mobility_notes IS DISTINCT FROM NEW.mobility_notes
    OR OLD.dietary_notes IS DISTINCT FROM NEW.dietary_notes
    OR OLD.communication_notes IS DISTINCT FROM NEW.communication_notes
    OR OLD.start_date IS DISTINCT FROM NEW.start_date
    OR OLD.end_date IS DISTINCT FROM NEW.end_date
    OR OLD.status IS DISTINCT FROM NEW.status
    OR OLD.visit_schedule IS DISTINCT FROM NEW.visit_schedule
    OR OLD.visit_schedule_as_of IS DISTINCT FROM NEW.visit_schedule_as_of
  )
  EXECUTE FUNCTION snapshot_care_plan_on_update();
--> statement-breakpoint

-- ── vitals ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "client_vitals" (
  "id" text PRIMARY KEY NOT NULL,
  "client_id" text NOT NULL,
  "caregiver_id" text,
  "time_entry_id" text,
  "recorded_at" timestamp DEFAULT now() NOT NULL,
  "systolic_bp" integer,
  "diastolic_bp" integer,
  "pulse" integer,
  "respirations" integer,
  "oxygen_saturation" integer,
  "temperature_f" numeric(4, 1),
  "blood_glucose" integer,
  "weight_lbs" numeric(5, 1),
  "pain_scale" integer,
  "pain_location" text,
  "notes" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "vitals_systolic_range"  CHECK ("systolic_bp" IS NULL OR "systolic_bp" BETWEEN 50 AND 260),
  CONSTRAINT "vitals_diastolic_range" CHECK ("diastolic_bp" IS NULL OR "diastolic_bp" BETWEEN 25 AND 160),
  CONSTRAINT "vitals_pulse_range"     CHECK ("pulse" IS NULL OR "pulse" BETWEEN 25 AND 220),
  CONSTRAINT "vitals_resp_range"      CHECK ("respirations" IS NULL OR "respirations" BETWEEN 4 AND 70),
  CONSTRAINT "vitals_o2_range"        CHECK ("oxygen_saturation" IS NULL OR "oxygen_saturation" BETWEEN 50 AND 100),
  CONSTRAINT "vitals_temp_range"      CHECK ("temperature_f" IS NULL OR "temperature_f" BETWEEN 85.0 AND 112.0),
  CONSTRAINT "vitals_glucose_range"   CHECK ("blood_glucose" IS NULL OR "blood_glucose" BETWEEN 20 AND 800),
  CONSTRAINT "vitals_weight_range"    CHECK ("weight_lbs" IS NULL OR "weight_lbs" BETWEEN 30 AND 800),
  CONSTRAINT "vitals_pain_range"      CHECK ("pain_scale" IS NULL OR "pain_scale" BETWEEN 0 AND 10)
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "client_vitals" ADD CONSTRAINT "client_vitals_client_id_clients_id_fk"
    FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "client_vitals" ADD CONSTRAINT "client_vitals_caregiver_id_users_id_fk"
    FOREIGN KEY ("caregiver_id") REFERENCES "users"("id");
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "client_vitals" ADD CONSTRAINT "client_vitals_time_entry_id_time_entries_id_fk"
    FOREIGN KEY ("time_entry_id") REFERENCES "time_entries"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_vitals_client_idx" ON "client_vitals" ("client_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_vitals_recorded_idx" ON "client_vitals" ("recorded_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_vitals_caregiver_idx" ON "client_vitals" ("caregiver_id");
--> statement-breakpoint

-- ── MAR ──────────────────────────────────────────────────────────────────────
ALTER TABLE "medication_logs" ADD COLUMN IF NOT EXISTS "time_entry_id" text;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "medication_logs" ADD CONSTRAINT "medication_logs_time_entry_id_time_entries_id_fk"
    FOREIGN KEY ("time_entry_id") REFERENCES "time_entries"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
ALTER TABLE "medication_logs" ADD COLUMN IF NOT EXISTS "scheduled_time" timestamp;
--> statement-breakpoint
ALTER TABLE "medication_logs" ADD COLUMN IF NOT EXISTS "dosage_given" text;
--> statement-breakpoint
ALTER TABLE "medication_logs" ADD COLUMN IF NOT EXISTS "witnessed_by" text;
--> statement-breakpoint
ALTER TABLE "medication_logs" ADD COLUMN IF NOT EXISTS "effective_status" text;
--> statement-breakpoint
-- Old rows: the strict status is the status they were logged with ('administered' was the
-- screen's old word for 'given').
UPDATE "medication_logs"
   SET "effective_status" = CASE WHEN "status" IN ('given','refused','held','self_administered','missed') THEN "status" ELSE 'given' END
 WHERE "effective_status" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "medication_logs_time_entry_idx" ON "medication_logs" ("time_entry_id");
--> statement-breakpoint

-- ── documents + e-signature ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "documents" (
  "id" text PRIMARY KEY NOT NULL,
  "entity_type" text NOT NULL,
  "entity_id" text,
  "document_type" text DEFAULT 'other' NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "file_url" text,
  "file_name" text,
  "file_type" text,
  "file_size" integer,
  -- the file itself, base64. A Render disk is wiped on every deploy, so a file kept only on disk
  -- is a link to nothing after the next release.
  "file_data" text,
  "requires_signature" boolean DEFAULT false NOT NULL,
  "expiration_date" date,
  "is_confidential" boolean DEFAULT false NOT NULL,
  "uploaded_by_id" text,
  "signed_at" timestamp,
  "signed_by_id" text,
  "signature_image" text,
  "signature_ip" text,
  "signature_user_agent" text,
  "signature_typed_name" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "documents_entity_type_check" CHECK ("entity_type" IN ('client','caregiver','company'))
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_id_users_id_fk"
    FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id");
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "documents" ADD CONSTRAINT "documents_signed_by_id_users_id_fk"
    FOREIGN KEY ("signed_by_id") REFERENCES "users"("id");
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "documents_entity_idx" ON "documents" ("entity_type", "entity_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "documents_expiration_idx" ON "documents" ("expiration_date");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "document_signatures" (
  "id" text PRIMARY KEY NOT NULL,
  "document_id" text NOT NULL,
  "signed_by_id" text NOT NULL,
  "signer_role" text,
  "signer_typed_name" text,
  "signature_image" text NOT NULL,
  "signed_at" timestamp DEFAULT now() NOT NULL,
  "ip_address" text,
  "user_agent" text
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "document_signatures" ADD CONSTRAINT "document_signatures_document_id_documents_id_fk"
    FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "document_signatures" ADD CONSTRAINT "document_signatures_signed_by_id_users_id_fk"
    FOREIGN KEY ("signed_by_id") REFERENCES "users"("id");
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_signatures_document_idx" ON "document_signatures" ("document_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_signatures_signer_idx" ON "document_signatures" ("signed_by_id");
--> statement-breakpoint

-- ── form library ─────────────────────────────────────────────────────────────
ALTER TABLE "form_templates" ADD COLUMN IF NOT EXISTS "is_built_in" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
-- A built-in that only applies in one state (a state Medicaid form). NULL = every agency.
ALTER TABLE "form_templates" ADD COLUMN IF NOT EXISTS "state" text;
--> statement-breakpoint
INSERT INTO "form_templates" ("id", "name", "description", "category", "fields", "requires_signature", "auto_attach_to", "is_active", "is_built_in", "state")
SELECT gen_random_uuid()::text, t.name, t.description, t.category, t.fields::json, t.requires_signature, t.auto_attach_to, true, true, t.state FROM (VALUES
  (
    'Client Intake Form',
    'Initial demographic + medical history captured at first contact.',
    'intake',
    '[
      { "id": "preferred_name", "label": "What name does the client prefer to go by?", "type": "text", "required": false },
      { "id": "primary_concern", "label": "Primary reason for requesting home care", "type": "textarea", "required": true },
      { "id": "diagnoses", "label": "Current diagnoses (comma-separated)", "type": "textarea", "required": false },
      { "id": "allergies", "label": "Allergies (food, medication, environmental)", "type": "textarea", "required": true },
      { "id": "current_meds", "label": "Current medications (name, dose, frequency)", "type": "textarea", "required": true },
      { "id": "mobility_status", "label": "Mobility status", "type": "radio", "required": true, "options": ["Fully ambulatory", "Walker / cane", "Wheelchair (transfers self)", "Wheelchair (needs transfer assist)", "Bed-bound"] },
      { "id": "cognitive_status", "label": "Cognitive status", "type": "select", "required": true, "options": ["Alert and oriented x3", "Mild forgetfulness", "Moderate dementia", "Advanced dementia", "Non-verbal"] },
      { "id": "fall_risk", "label": "Fall history in last 6 months?", "type": "radio", "required": true, "options": ["No falls", "1 fall", "2-3 falls", "More than 3 falls"] },
      { "id": "primary_caregiver_family", "label": "Primary family caregiver (name + relationship)", "type": "text", "required": false },
      { "id": "advance_directive", "label": "Has an advance directive / POLST on file?", "type": "radio", "required": true, "options": ["Yes (copy provided)", "Yes (not provided)", "No", "Unknown"] },
      { "id": "pets", "label": "Pets in the home?", "type": "text", "required": false },
      { "id": "smoking_in_home", "label": "Smoking in the home?", "type": "radio", "required": true, "options": ["No", "Yes - resident only", "Yes - visitors"] },
      { "id": "weapons_in_home", "label": "Firearms in the home? (safety question)", "type": "radio", "required": true, "options": ["No", "Yes - secured", "Yes - unsecured"] }
    ]',
    false, 'client', NULL
  ),
  (
    'HIPAA Authorization to Release Information',
    'Required release for sharing PHI with named family members or other providers.',
    'consent',
    '[
      { "id": "auth_release_to_name", "label": "Authorize release of my health information to (name)", "type": "text", "required": true },
      { "id": "auth_release_to_relationship", "label": "Relationship to me", "type": "text", "required": true },
      { "id": "auth_release_to_phone", "label": "Phone number of authorized party", "type": "text", "required": true },
      { "id": "info_categories", "label": "Categories of information to release", "type": "checkbox", "required": true, "options": ["Visit schedule", "Care plan", "Medication list", "Vitals / observations", "Billing / invoices", "Incidents", "Discharge information"] },
      { "id": "purpose", "label": "Purpose of disclosure", "type": "select", "required": true, "options": ["At my request", "Care coordination", "Family involvement", "Legal", "Other"] },
      { "id": "expires_in", "label": "This authorization expires in", "type": "select", "required": true, "options": ["6 months", "1 year", "Until revoked", "Upon discharge"] },
      { "id": "right_to_revoke", "label": "I understand I may revoke this authorization in writing at any time.", "type": "checkbox", "required": true, "options": ["I understand"] }
    ]',
    true, 'client', NULL
  ),
  (
    'Service Agreement — Private Pay',
    'Contract between agency and private-pay client specifying services, rate, and terms.',
    'general',
    '[
      { "id": "services_authorized", "label": "Services authorized", "type": "checkbox", "required": true, "options": ["Personal care (bathing, grooming)", "Mobility assistance", "Meal preparation", "Light housekeeping", "Errands / transportation", "Companionship", "Medication reminders", "Other (specify in notes)"] },
      { "id": "hours_per_week", "label": "Anticipated hours per week", "type": "number", "required": true },
      { "id": "hourly_rate", "label": "Hourly rate ($)", "type": "number", "required": true },
      { "id": "billing_cycle", "label": "Billing cycle", "type": "select", "required": true, "options": ["Weekly", "Bi-weekly", "Monthly"] },
      { "id": "payment_method", "label": "Preferred payment method", "type": "select", "required": true, "options": ["Check", "ACH / bank transfer", "Credit card", "Long-term care insurance"] },
      { "id": "min_cancel_notice", "label": "Cancellation notice required", "type": "select", "required": true, "options": ["24 hours", "48 hours", "1 week", "No fee for any cancellation"] },
      { "id": "late_fee", "label": "Late payment fee (% per month past 30 days)", "type": "number", "required": false },
      { "id": "agreement_acknowledgement", "label": "I have read and agree to the terms above.", "type": "checkbox", "required": true, "options": ["I agree"] }
    ]',
    true, 'client', NULL
  ),
  (
    'Wisconsin Plan of Care (POC)',
    'Plan of Care required for WI Medicaid personal care services. Replaces the MA-1A elements that apply.',
    'physician_order',
    '[
      { "id": "primary_diagnosis", "label": "Primary diagnosis (ICD-10)", "type": "text", "required": true },
      { "id": "secondary_diagnoses", "label": "Secondary diagnoses", "type": "textarea", "required": false },
      { "id": "functional_limitations", "label": "Functional limitations", "type": "checkbox", "required": true, "options": ["Ambulation", "Transfer", "Bathing", "Toileting", "Dressing", "Eating", "Meal prep", "Medication management", "Communication", "Cognition"] },
      { "id": "adl_assist_level", "label": "Level of ADL assistance required", "type": "radio", "required": true, "options": ["Independent", "Supervision", "Limited assist", "Extensive assist", "Total dependence"] },
      { "id": "skilled_nursing_needed", "label": "Skilled nursing needed?", "type": "radio", "required": true, "options": ["No", "Yes - intermittent", "Yes - daily"] },
      { "id": "frequency_of_visits", "label": "Frequency of visits", "type": "text", "required": true },
      { "id": "duration_per_visit", "label": "Duration per visit (hours)", "type": "number", "required": true },
      { "id": "goals_short_term", "label": "Short-term goals (30-90 days)", "type": "textarea", "required": true },
      { "id": "goals_long_term", "label": "Long-term goals", "type": "textarea", "required": true },
      { "id": "discharge_criteria", "label": "Discharge criteria", "type": "textarea", "required": false },
      { "id": "physician_name", "label": "Ordering physician", "type": "text", "required": true },
      { "id": "physician_signature_date", "label": "Physician signature date", "type": "text", "required": true }
    ]',
    true, 'client', 'WI'
  ),
  (
    'Medication Administration Authorization',
    'Required when caregivers administer (not just remind) medications.',
    'physician_order',
    '[
      { "id": "client_consent", "label": "Client / legal rep authorizes agency caregivers to administer medications as listed in the current medication list.", "type": "checkbox", "required": true, "options": ["I authorize"] },
      { "id": "administered_categories", "label": "Categories authorized for administration", "type": "checkbox", "required": true, "options": ["Oral medications", "Topical (creams, ointments)", "Eye drops", "Ear drops", "Nasal sprays", "Insulin (per RN training)", "Inhalers / nebulizers", "Suppositories"] },
      { "id": "training_verified", "label": "Caregiver has documented medication training", "type": "checkbox", "required": true, "options": ["Verified by RN", "Verified by agency director", "Pending — admin only until verified"] },
      { "id": "controlled_substances", "label": "Are controlled substances involved?", "type": "radio", "required": true, "options": ["No", "Yes - witnessed administration required"] },
      { "id": "errors_protocol", "label": "Caregiver acknowledges medication-error reporting protocol (notify supervisor immediately).", "type": "checkbox", "required": true, "options": ["Acknowledged"] }
    ]',
    true, 'client', NULL
  ),
  (
    'Emergency Contact Information',
    'Primary + backup contacts for incidents, hospital admissions, schedule changes.',
    'intake',
    '[
      { "id": "ec1_name",         "label": "Primary contact — name", "type": "text", "required": true },
      { "id": "ec1_relationship", "label": "Primary contact — relationship", "type": "text", "required": true },
      { "id": "ec1_phone",        "label": "Primary contact — phone (cell preferred)", "type": "text", "required": true },
      { "id": "ec1_can_decide",   "label": "Primary contact authorized to make care decisions?", "type": "radio", "required": true, "options": ["Yes - durable POA", "Yes - informally", "No"] },
      { "id": "ec2_name",         "label": "Secondary contact — name", "type": "text", "required": false },
      { "id": "ec2_relationship", "label": "Secondary contact — relationship", "type": "text", "required": false },
      { "id": "ec2_phone",        "label": "Secondary contact — phone", "type": "text", "required": false },
      { "id": "preferred_hospital", "label": "Preferred hospital", "type": "text", "required": false },
      { "id": "dnr_on_file",      "label": "Do Not Resuscitate order on file?", "type": "radio", "required": true, "options": ["No", "Yes (POLST/MOLST attached)", "Yes (verbal only)"] }
    ]',
    false, 'client', NULL
  ),
  (
    'Caregiver Employment Agreement',
    'At-hire agreement covering scope, confidentiality, pay, conduct, termination.',
    'hr',
    '[
      { "id": "position",        "label": "Position", "type": "select", "required": true, "options": ["Personal Care Worker", "Home Health Aide", "Companion", "CNA", "RN", "LPN"] },
      { "id": "start_date",      "label": "Start date", "type": "text", "required": true },
      { "id": "hourly_rate",     "label": "Hourly rate ($)", "type": "number", "required": true },
      { "id": "weekly_hours",    "label": "Expected weekly hours", "type": "number", "required": true },
      { "id": "employment_type", "label": "Employment classification", "type": "select", "required": true, "options": ["W-2 employee", "1099 contractor"] },
      { "id": "confidentiality", "label": "Confidentiality / HIPAA acknowledgment", "type": "checkbox", "required": true, "options": ["I will keep all client PHI confidential and follow HIPAA + agency privacy policies."] },
      { "id": "boundaries",      "label": "Professional boundaries acknowledgment", "type": "checkbox", "required": true, "options": ["No personal financial transactions with clients, no gifts > $25, no posting client info on social media."] },
      { "id": "at_will",         "label": "I understand employment is at-will and either party may terminate the relationship with notice per policy.", "type": "checkbox", "required": true, "options": ["I understand"] }
    ]',
    true, 'caregiver', NULL
  ),
  (
    'Photo / Media Release',
    'Optional consent for using client photo on agency marketing materials.',
    'consent',
    '[
      { "id": "use_in_marketing", "label": "I grant the agency permission to use my photograph / likeness in", "type": "checkbox", "required": false, "options": ["Agency website", "Print brochures", "Social media (Facebook, etc.)", "Training materials (internal only)"] },
      { "id": "no_identification", "label": "My name should not be displayed with my photo.", "type": "checkbox", "required": false, "options": ["Anonymous use only"] },
      { "id": "right_to_revoke", "label": "I understand I may revoke this release in writing at any time. Already-printed materials are not recallable.", "type": "checkbox", "required": true, "options": ["I understand"] }
    ]',
    true, 'client', NULL
  )
) AS t(name, description, category, fields, requires_signature, auto_attach_to, state)
WHERE NOT EXISTS (SELECT 1 FROM "form_templates" WHERE "is_built_in" = true);
--> statement-breakpoint
-- The In-Home Client Assessment, completed in the client's home at start of care, each periodic
-- review and after any change in condition. "section" = a heading (no data); "date" = a date
-- picker; a "checkbox" WITH options is multi-select (the value is the array of picked options).
INSERT INTO "form_templates" ("id", "name", "description", "category", "fields", "requires_signature", "auto_attach_to", "is_active", "is_built_in")
SELECT
  gen_random_uuid()::text,
  'In-Home Client Assessment',
  'Completed in the client''s home at start of care, at each periodic review, and after any change in condition or hospital stay.',
  'assessment',
  '[
    { "id": "sec_visit", "type": "section", "label": "Assessment Visit" },
    { "id": "assessment_type", "label": "Type of assessment", "type": "radio", "required": true, "options": ["Initial (start of care)", "Periodic review", "Change in condition", "After hospital / rehab stay"] },
    { "id": "assessment_date", "label": "Assessment date", "type": "date", "required": true },
    { "id": "present", "label": "Who was present (name + relationship)", "type": "text", "required": false },
    { "id": "payer", "label": "Payer", "type": "select", "required": false, "options": ["Private pay", "Medicaid / managed care (MCO)", "Self-directed program", "VA", "Long-term care insurance", "Other"] },

    { "id": "sec_health", "type": "section", "label": "Health" },
    { "id": "diagnoses", "label": "Diagnoses", "type": "textarea", "required": false },
    { "id": "allergies", "label": "Allergies (medication, food, environmental) - write NKA if none", "type": "textarea", "required": true },
    { "id": "medications", "label": "Current medications (name, dose, how often)", "type": "textarea", "required": false },
    { "id": "med_management", "label": "Medication management", "type": "radio", "required": true, "options": ["Independent", "Needs reminders", "Needs set-up (pill box filled by family / nurse)", "Managed entirely by others"] },
    { "id": "physician", "label": "Primary physician (name + phone)", "type": "text", "required": false },
    { "id": "hospitalization", "label": "Hospital or ER visit recently?", "type": "radio", "required": false, "options": ["None in 6 months", "Within last 30 days", "Within last 6 months"] },
    { "id": "hospitalization_notes", "label": "Hospital / ER details", "type": "textarea", "required": false },

    { "id": "sec_senses", "type": "section", "label": "Vision, Hearing, Communication" },
    { "id": "vision", "label": "Vision", "type": "radio", "required": false, "options": ["Adequate", "Impaired - uses glasses", "Severely impaired / blind"] },
    { "id": "hearing", "label": "Hearing", "type": "radio", "required": false, "options": ["Adequate", "Hard of hearing", "Uses hearing aids", "Deaf"] },
    { "id": "communication", "label": "Communication", "type": "radio", "required": false, "options": ["Speaks clearly", "Some difficulty", "Non-verbal"] },
    { "id": "language", "label": "Primary language (if not English)", "type": "text", "required": false },

    { "id": "sec_cognition", "type": "section", "label": "Memory, Mood, Behavior" },
    { "id": "cognition", "label": "Memory / orientation", "type": "radio", "required": true, "options": ["Alert and oriented", "Mild forgetfulness", "Moderate impairment", "Severe impairment"] },
    { "id": "dementia_dx", "label": "Diagnosed dementia or Alzheimer''s?", "type": "radio", "required": false, "options": ["No", "Yes", "Suspected, not diagnosed"] },
    { "id": "behaviors", "label": "Behaviors seen or reported", "type": "checkbox", "required": false, "options": ["None", "Wandering", "Agitation", "Verbal aggression", "Physical aggression", "Resists care", "Sundowning", "Hallucinations", "Depression / withdrawal", "Anxiety"] },
    { "id": "safe_alone", "label": "Safe to be left alone?", "type": "radio", "required": true, "options": ["Yes", "Short periods only", "No - needs supervision"] },

    { "id": "sec_adl", "type": "section", "label": "Activities of Daily Living (ADLs)" },
    { "id": "adl_bathing", "label": "Bathing", "type": "radio", "required": true, "options": ["Independent", "Supervision / cueing", "Some hands-on help", "Total help", "N/A"] },
    { "id": "adl_dressing", "label": "Dressing", "type": "radio", "required": true, "options": ["Independent", "Supervision / cueing", "Some hands-on help", "Total help", "N/A"] },
    { "id": "adl_grooming", "label": "Grooming / oral care", "type": "radio", "required": true, "options": ["Independent", "Supervision / cueing", "Some hands-on help", "Total help", "N/A"] },
    { "id": "adl_toileting", "label": "Toileting", "type": "radio", "required": true, "options": ["Independent", "Supervision / cueing", "Some hands-on help", "Total help", "N/A"] },
    { "id": "adl_continence", "label": "Continence", "type": "radio", "required": true, "options": ["Continent", "Occasional accidents", "Incontinent - bladder", "Incontinent - bladder and bowel", "Catheter / ostomy"] },
    { "id": "adl_transfers", "label": "Transfers (bed, chair, toilet)", "type": "radio", "required": true, "options": ["Independent", "Supervision / cueing", "Some hands-on help", "Total help", "N/A"] },
    { "id": "adl_mobility", "label": "Walking / getting around", "type": "radio", "required": true, "options": ["Independent", "Supervision / cueing", "Some hands-on help", "Total help", "N/A"] },
    { "id": "adl_eating", "label": "Eating", "type": "radio", "required": true, "options": ["Independent", "Supervision / cueing", "Some hands-on help", "Total help", "N/A"] },
    { "id": "equipment", "label": "Equipment in use", "type": "checkbox", "required": false, "options": ["None", "Cane", "Walker", "Wheelchair", "Hoyer lift", "Gait belt", "Grab bars", "Shower chair / tub bench", "Raised toilet seat", "Commode", "Hospital bed", "Oxygen"] },
    { "id": "adl_notes", "label": "ADL notes (how the client likes things done)", "type": "textarea", "required": false },

    { "id": "sec_iadl", "type": "section", "label": "Household Tasks (IADLs)" },
    { "id": "iadl_meals", "label": "Meal preparation", "type": "radio", "required": true, "options": ["Independent", "Needs some help", "Unable - needs it done", "Done by family"] },
    { "id": "iadl_housekeeping", "label": "Housekeeping", "type": "radio", "required": true, "options": ["Independent", "Needs some help", "Unable - needs it done", "Done by family"] },
    { "id": "iadl_laundry", "label": "Laundry", "type": "radio", "required": true, "options": ["Independent", "Needs some help", "Unable - needs it done", "Done by family"] },
    { "id": "iadl_shopping", "label": "Shopping / errands", "type": "radio", "required": true, "options": ["Independent", "Needs some help", "Unable - needs it done", "Done by family"] },
    { "id": "iadl_transport", "label": "Transportation", "type": "radio", "required": false, "options": ["Drives self", "Needs rides", "Unable to leave home", "Done by family"] },
    { "id": "iadl_phone", "label": "Using the phone", "type": "radio", "required": false, "options": ["Independent", "Needs some help", "Unable"] },
    { "id": "iadl_finances", "label": "Managing money / bills", "type": "radio", "required": false, "options": ["Independent", "Needs some help", "Handled by family / POA"] },

    { "id": "sec_falls", "type": "section", "label": "Fall Risk" },
    { "id": "falls_6mo", "label": "Falls in the last 6 months", "type": "radio", "required": true, "options": ["None", "1", "2-3", "More than 3"] },
    { "id": "fall_factors", "label": "Fall risk factors", "type": "checkbox", "required": false, "options": ["None", "Unsteady gait", "Dizziness", "Fear of falling", "Uses walker / cane inconsistently", "Night-time toileting", "Poor vision", "Medications that cause drowsiness"] },
    { "id": "fall_risk", "label": "Overall fall risk", "type": "radio", "required": true, "options": ["Low", "Moderate", "High"] },

    { "id": "sec_skin", "type": "section", "label": "Skin and Nutrition" },
    { "id": "skin", "label": "Skin condition", "type": "radio", "required": false, "options": ["Intact", "Fragile / bruises easily", "Open area or pressure sore - nurse notified"] },
    { "id": "diet", "label": "Diet", "type": "checkbox", "required": false, "options": ["Regular", "Diabetic", "Low sodium", "Soft / pureed", "Thickened liquids", "Tube feeding", "Other (see notes)"] },
    { "id": "swallowing", "label": "Trouble chewing or swallowing?", "type": "radio", "required": false, "options": ["No", "Yes"] },
    { "id": "appetite", "label": "Appetite / weight change", "type": "radio", "required": false, "options": ["Good, stable", "Poor appetite", "Recent weight loss", "Recent weight gain"] },

    { "id": "sec_home", "type": "section", "label": "Home Safety" },
    { "id": "living", "label": "Lives", "type": "radio", "required": true, "options": ["Alone", "With spouse / partner", "With family", "Other"] },
    { "id": "home_hazards", "label": "Hazards found", "type": "checkbox", "required": false, "options": ["None", "Throw rugs", "Clutter in walkways", "Poor lighting", "Stairs without railing", "No grab bars in bathroom", "Pets underfoot", "Smoking in home", "Oxygen in use", "Firearms (unsecured)", "Hoarding", "Pests / sanitation"] },
    { "id": "smoke_detectors", "label": "Working smoke detectors?", "type": "radio", "required": false, "options": ["Yes", "No", "Not checked"] },
    { "id": "emergency_pendant", "label": "Medical alert / emergency pendant?", "type": "radio", "required": false, "options": ["Yes", "No"] },
    { "id": "entry", "label": "How caregivers get in (key, lockbox code location, door)", "type": "text", "required": false },
    { "id": "pets", "label": "Pets", "type": "text", "required": false },

    { "id": "sec_support", "type": "section", "label": "Support and Wishes" },
    { "id": "family_contact", "label": "Main family contact (name, relationship, phone)", "type": "text", "required": false },
    { "id": "poa", "label": "Power of attorney / guardian (name, phone)", "type": "text", "required": false },
    { "id": "advance_directive", "label": "Advance directive / POLST", "type": "radio", "required": false, "options": ["Yes - copy on file", "Yes - no copy yet", "No", "Unknown"] },
    { "id": "code_status", "label": "Code status", "type": "radio", "required": false, "options": ["Full code", "DNR", "Unknown"] },

    { "id": "sec_plan", "type": "section", "label": "Recommended Services" },
    { "id": "services", "label": "Services recommended", "type": "checkbox", "required": true, "options": ["Personal care", "Bathing", "Medication reminders", "Meal preparation", "Light housekeeping", "Laundry", "Errands / shopping", "Transportation", "Companionship", "Respite", "Overnight"] },
    { "id": "hours_per_week", "label": "Recommended hours per week", "type": "number", "required": false },
    { "id": "visit_schedule", "label": "Preferred days and times", "type": "text", "required": false },
    { "id": "client_goals", "label": "Client / family goals", "type": "textarea", "required": false },
    { "id": "caregiver_prefs", "label": "Caregiver preferences (gender, allergies to pets, non-smoker, etc.)", "type": "textarea", "required": false },
    { "id": "referrals", "label": "Referrals or follow-up needed (nurse, PT, social worker, equipment)", "type": "textarea", "required": false },
    { "id": "next_review", "label": "Next reassessment date", "type": "date", "required": false },
    { "id": "assessor", "label": "Completed by (name and title)", "type": "text", "required": true }
  ]'::json,
  true, 'client', true, true
WHERE NOT EXISTS (SELECT 1 FROM "form_templates" WHERE "name" = 'In-Home Client Assessment');
--> statement-breakpoint

-- ── insurance card photos ───────────────────────────────────────────────────
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "insurance_card_front" text;
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "insurance_card_back" text;
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "insurance_card_uploaded_at" timestamp;
--> statement-breakpoint
-- ~5 MB raw per side (base64 data URI).
DO $$ BEGIN
  ALTER TABLE "clients" ADD CONSTRAINT "clients_insurance_front_size_cap"
    CHECK ("insurance_card_front" IS NULL OR LENGTH("insurance_card_front") <= 7000000);
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "clients" ADD CONSTRAINT "clients_insurance_back_size_cap"
    CHECK ("insurance_card_back" IS NULL OR LENGTH("insurance_card_back") <= 7000000);
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

-- ── ADL logs belong to a visit ──────────────────────────────────────────────
ALTER TABLE "adl_logs" ADD COLUMN IF NOT EXISTS "time_entry_id" text;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "adl_logs" ADD CONSTRAINT "adl_logs_time_entry_id_time_entries_id_fk"
    FOREIGN KEY ("time_entry_id") REFERENCES "time_entries"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "adl_logs_time_entry_idx" ON "adl_logs" ("time_entry_id");
