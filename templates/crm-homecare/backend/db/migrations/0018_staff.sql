-- Staff: hiring, onboarding, background checks, payday verification.
--
-- Ported from the CVHC CRM: v28 (application form columns), v30 (payroll period verifications),
-- v31 (job postings), v32 (onboarding packets + Gusto sync), v33 (caregiver disqualifiers),
-- v51 (server-side logout), v67 (background check documents). Additive only.
--
-- Template columns reused instead of CVHC's duplicates:
--   job_applications.earliest_start_date  -> applications.available_start_date
--   job_applications.additional_info      -> applications.notes
--   job_applications.ref1_* / ref2_*      -> applications.references (json array)
--   users.gusto_employee_id / gusto_synced_at / gusto_synced_by
--                                         -> gusto_employee_map (gusto_employee_id, last_synced_at, + synced_by_id)
--   background WORCS reference number     -> background_checks.worcs_reference_number

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_logout_at" timestamp;
--> statement-breakpoint
ALTER TABLE "gusto_employee_map" ADD COLUMN IF NOT EXISTS "synced_by_id" text;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "gusto_employee_map"
    ADD CONSTRAINT "gusto_employee_map_synced_by_id_users_id_fk"
    FOREIGN KEY ("synced_by_id") REFERENCES "users"("id");
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint

-- ── Job postings ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "job_postings" (
  "id" text PRIMARY KEY NOT NULL,
  "title" text NOT NULL,
  "slug" text NOT NULL,
  "employment_type" text DEFAULT 'part_time' NOT NULL,
  "location" text,
  "pay_range_min" numeric(10, 2),
  "pay_range_max" numeric(10, 2),
  "pay_rate_unit" text DEFAULT 'hour' NOT NULL,
  "summary" text,
  "description" text NOT NULL,
  "responsibilities" text,
  "qualifications" text,
  "is_published" boolean DEFAULT false NOT NULL,
  "published_at" timestamp,
  "closes_at" timestamp,
  "applications_count" integer DEFAULT 0 NOT NULL,
  "created_by_id" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "job_postings_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "job_postings"
    ADD CONSTRAINT "job_postings_created_by_id_users_id_fk"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id");
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_postings_published_idx" ON "job_postings" ("is_published", "closes_at");
--> statement-breakpoint

-- ── Application form columns (the public careers form) ──────────────────────
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "date_of_birth" date;
--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "has_drivers_license" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "has_transportation" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "legal_to_work" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "willing_background_check" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "felony_conviction" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "felony_explanation" text;
--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "years_experience" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "cna_license" text;
--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "certifications" json DEFAULT '[]'::json NOT NULL;
--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "previous_employer" text;
--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "reason_for_leaving" text;
--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "availability_days" text;
--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "availability_shifts" text;
--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "hours_desired" text;
--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "why_interested" text;
--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN IF NOT EXISTS "posting_id" text;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "applications"
    ADD CONSTRAINT "applications_posting_id_job_postings_id_fk"
    FOREIGN KEY ("posting_id") REFERENCES "job_postings"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "applications_email_idx" ON "applications" ("email");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "applications_posting_id_idx" ON "applications" ("posting_id");
--> statement-breakpoint

-- ── Onboarding packets ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "onboarding_packets" (
  "id" text PRIMARY KEY NOT NULL,
  "caregiver_id" text NOT NULL,
  "application_id" text,
  "token" text NOT NULL,
  "expires_at" timestamp NOT NULL,
  "status" text DEFAULT 'sent' NOT NULL,
  "preferred_name" text,
  "legal_first_name" text,
  "legal_middle_name" text,
  "legal_last_name" text,
  "pronouns" text,
  "address" text,
  "city" text,
  "state" text,
  "zip" text,
  "date_of_birth" date,
  "drivers_license_number" text,
  "drivers_license_state" text,
  "emergency_contact_name" text,
  "emergency_contact_relationship" text,
  "emergency_contact_phone" text,
  "emergency_contact_email" text,
  "bgc_consent_signed_at" timestamp,
  "bgc_consent_signature" text,
  "bgc_consent_ip" text,
  "bgc_consent_user_agent" text,
  "bgc_consent_version" text,
  "bgc_consent_disclosure_text" text,
  "ssn_transient_encrypted" text,
  "opened_at" timestamp,
  "submitted_at" timestamp,
  "created_by_id" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "onboarding_packets_token_unique" UNIQUE("token")
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "onboarding_packets"
    ADD CONSTRAINT "onboarding_packets_caregiver_id_users_id_fk"
    FOREIGN KEY ("caregiver_id") REFERENCES "users"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "onboarding_packets"
    ADD CONSTRAINT "onboarding_packets_application_id_applications_id_fk"
    FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "onboarding_packets"
    ADD CONSTRAINT "onboarding_packets_created_by_id_users_id_fk"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id");
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "onboarding_packets_caregiver_idx" ON "onboarding_packets" ("caregiver_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "onboarding_packets_status_idx" ON "onboarding_packets" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "onboarding_packets_expires_idx" ON "onboarding_packets" ("expires_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "onboarding_packet_events" (
  "id" text PRIMARY KEY NOT NULL,
  "packet_id" text NOT NULL,
  "event_type" text NOT NULL,
  "ip_address" text,
  "user_agent" text,
  "metadata" json,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "onboarding_packet_events"
    ADD CONSTRAINT "onboarding_packet_events_packet_id_onboarding_packets_id_fk"
    FOREIGN KEY ("packet_id") REFERENCES "onboarding_packets"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "onboarding_packet_events_packet_idx" ON "onboarding_packet_events" ("packet_id", "created_at");
--> statement-breakpoint

-- ── Background checks: the result + completed date, and the result letters ───
ALTER TABLE "background_checks" ADD COLUMN IF NOT EXISTS "result" text;
--> statement-breakpoint
ALTER TABLE "background_checks" ADD COLUMN IF NOT EXISTS "completed_date" date;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "background_checks_expiration_date_idx" ON "background_checks" ("expiration_date");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "background_check_documents" (
  "id" text PRIMARY KEY NOT NULL,
  "background_check_id" text NOT NULL,
  "file_name" text NOT NULL,
  "mime_type" text NOT NULL,
  "file_size" integer,
  "file_data" text NOT NULL,
  "uploaded_by_id" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "background_check_documents"
    ADD CONSTRAINT "background_check_documents_background_check_id_background_checks_id_fk"
    FOREIGN KEY ("background_check_id") REFERENCES "background_checks"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "background_check_documents"
    ADD CONSTRAINT "background_check_documents_uploaded_by_id_users_id_fk"
    FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id");
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "background_check_documents_check_idx" ON "background_check_documents" ("background_check_id", "created_at");
--> statement-breakpoint

-- ── Caregiver disqualifiers (statutory bar list) ────────────────────────────
CREATE TABLE IF NOT EXISTS "caregiver_disqualifiers" (
  "id" text PRIMARY KEY NOT NULL,
  "state" text,
  "category" text NOT NULL,
  "statute" text NOT NULL,
  "short_title" text NOT NULL,
  "description" text,
  "severity" text NOT NULL,
  "match_patterns" json DEFAULT '[]'::json NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "caregiver_disqualifiers_active_idx" ON "caregiver_disqualifiers" ("is_active", "severity");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "caregiver_disqualifiers_state_idx" ON "caregiver_disqualifiers" ("state");
--> statement-breakpoint
-- Wisconsin bar list (Wis. Stat. 50.065(2)(bd), 48.685, DHS 12.07(1m)(a)). state = 'WI', so the
-- eligibility engine uses these only for an agency whose state is WI.
--   permanent_bar = the conviction bars caregiver employment, no rehabilitation review available
--   rehab_review  = bars employment unless DHS rehabilitation review finds substantial rehabilitation
--   advisory      = worth flagging, does not legally bar employment
-- Patterns are case-insensitive regex fragments matched against the check's findings text.
INSERT INTO "caregiver_disqualifiers" ("id", "state", "category", "statute", "short_title", "description", "severity", "match_patterns") VALUES
  ('wi-940-01',  'WI', 'violence',       'Wis. Stat. § 940.01',  'First-degree intentional homicide',       'Intentional killing.',                                        'permanent_bar', '["first[- ]degree.*intentional.*homicide","first[- ]degree.*murder","intentional homicide"]'),
  ('wi-940-02',  'WI', 'violence',       'Wis. Stat. § 940.02',  'First-degree reckless homicide',          'Reckless killing under circumstances showing depraved mind.', 'permanent_bar', '["first[- ]degree.*reckless.*homicide"]'),
  ('wi-940-05',  'WI', 'violence',       'Wis. Stat. § 940.05',  'Second-degree intentional homicide',      'Intentional killing with mitigating circumstances.',          'permanent_bar', '["second[- ]degree.*intentional.*homicide"]'),
  ('wi-940-19',  'WI', 'violence',       'Wis. Stat. § 940.19',  'Aggravated battery',                      'Battery causing great bodily harm.',                          'rehab_review',  '["aggravated battery","great bodily harm"]'),
  ('wi-940-225', 'WI', 'violence',       'Wis. Stat. § 940.225', 'Sexual assault (1st/2nd/3rd degree)',     'Nonconsensual sexual contact or intercourse.',                'permanent_bar', '["sexual assault","sexual intercourse.*without consent","1st degree sexual","2nd degree sexual","3rd degree sexual"]'),
  ('wi-940-285', 'WI', 'violence',       'Wis. Stat. § 940.285', 'Abuse of a vulnerable adult',             'Intentional/negligent abuse of a vulnerable adult.',          'permanent_bar', '["abuse.*vulnerable adult","abuse of elderly","abuse of patient","abuse of resident"]'),
  ('wi-940-295', 'WI', 'violence',       'Wis. Stat. § 940.295', 'Abuse/neglect of patients/residents',     'Abuse or neglect in a care setting.',                         'permanent_bar', '["abuse.*patient","abuse.*resident","neglect.*patient","neglect.*resident"]'),
  ('wi-948-02',  'WI', 'child_offenses', 'Wis. Stat. § 948.02',  'Sexual assault of a child',               'Sexual contact/intercourse with person under 16.',            'permanent_bar', '["sexual assault.*child","sexual contact.*child","948\\.02"]'),
  ('wi-948-03',  'WI', 'child_offenses', 'Wis. Stat. § 948.03',  'Physical abuse of a child',               'Physical abuse of a child.',                                  'permanent_bar', '["physical abuse.*child","child abuse","948\\.03"]'),
  ('wi-948-04',  'WI', 'child_offenses', 'Wis. Stat. § 948.04',  'Causing mental harm to a child',          'Intentional mental harm.',                                    'rehab_review',  '["mental harm.*child","948\\.04"]'),
  ('wi-948-05',  'WI', 'child_offenses', 'Wis. Stat. § 948.05',  'Sexual exploitation of a child',          'Causing/permitting sexual conduct.',                          'permanent_bar', '["sexual exploitation.*child","948\\.05"]'),
  ('wi-948-055', 'WI', 'child_offenses', 'Wis. Stat. § 948.055', 'Causing child to view/listen to sexual activity', 'Exposing minors to sexual activity.',             'permanent_bar', '["child.*view.*sexual","child.*listen.*sexual","948\\.055"]'),
  ('wi-948-06',  'WI', 'child_offenses', 'Wis. Stat. § 948.06',  'Incest with a child',                     'Sexual contact with child relative.',                         'permanent_bar', '["incest.*child","948\\.06"]'),
  ('wi-948-07',  'WI', 'child_offenses', 'Wis. Stat. § 948.07',  'Child enticement',                        'Enticing a child into a secluded place.',                     'permanent_bar', '["child enticement","948\\.07"]'),
  ('wi-948-08',  'WI', 'child_offenses', 'Wis. Stat. § 948.08',  'Soliciting a child for prostitution',     'Soliciting a child for sex acts.',                            'permanent_bar', '["solicit.*child.*prostitut","948\\.08"]'),
  ('wi-948-21',  'WI', 'child_offenses', 'Wis. Stat. § 948.21',  'Neglect of a child',                      'Negligent failure to act as a parent/guardian.',              'rehab_review',  '["neglect.*child","948\\.21"]'),
  ('wi-948-22',  'WI', 'child_offenses', 'Wis. Stat. § 948.22',  'Failure to support (child abandonment)',  'Intentional failure to support.',                             'advisory',      '["failure to support","abandon.*child","948\\.22"]'),
  ('wi-943-20',  'WI', 'financial',      'Wis. Stat. § 943.20',  'Theft',                                   'Taking property of another.',                                 'rehab_review',  '["theft","larceny","943\\.20"]'),
  ('wi-943-201', 'WI', 'financial',      'Wis. Stat. § 943.201', 'Identity theft',                          'Using another person''s identity.',                           'rehab_review',  '["identity theft","943\\.201"]'),
  ('wi-943-38',  'WI', 'financial',      'Wis. Stat. § 943.38',  'Forgery',                                 'Falsification of a writing.',                                 'rehab_review',  '["forgery","943\\.38"]'),
  ('wi-943-41',  'WI', 'financial',      'Wis. Stat. § 943.41',  'Financial crimes (credit card etc.)',     'Credit/debit card fraud.',                                    'rehab_review',  '["credit card.*fraud","943\\.41"]'),
  ('wi-946-52',  'WI', 'financial',      'Wis. Stat. § 946.52',  'Theft from a vulnerable person',          'Financial exploitation of a vulnerable adult.',               'permanent_bar', '["theft.*vulnerable","financial.*exploit","946\\.52"]'),
  ('wi-961-41',  'WI', 'drugs',          'Wis. Stat. § 961.41',  'Controlled substance manufacture/delivery', 'Manufacture or delivery of a controlled substance.',        'rehab_review',  '["manufacture.*controlled","deliver.*controlled","961\\.41"]'),
  ('wi-961-573', 'WI', 'drugs',          'Wis. Stat. § 961.573', 'Drug paraphernalia possession',           'Possession of drug paraphernalia.',                           'advisory',      '["drug paraphernalia","961\\.573"]'),
  ('wi-941-29',  'WI', 'weapons',        'Wis. Stat. § 941.29',  'Possession of firearm by felon',          'Felon in possession of a firearm.',                           'rehab_review',  '["felon.*possession.*firearm","941\\.29"]'),
  ('wi-346-63',  'WI', 'driving',        'Wis. Stat. § 346.63',  'OWI — 3rd offense or higher',             'Operating while intoxicated, 3rd+ offense.',                  'advisory',      '["owi.*3rd","owi.*4th","owi.*5th","owi.*sixth","operating while intoxicated.*3rd","dwi.*3rd"]'),
  ('wi-346-67',  'WI', 'driving',        'Wis. Stat. § 346.67',  'Hit and run',                             'Leaving the scene of an accident.',                           'rehab_review',  '["hit and run","leaving.*scene","346\\.67"]'),
  ('wi-42cfr1001','WI','federal',        '42 CFR § 1001',        'OIG exclusion list',                      'Excluded from participation in federal healthcare programs.', 'permanent_bar', '["oig.*exclus","medicaid.*exclus","medicare.*exclus"]')
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint

-- ── Payday verification ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "payroll_period_verifications" (
  "id" text PRIMARY KEY NOT NULL,
  "caregiver_id" text NOT NULL,
  "pay_period_start" date NOT NULL,
  "pay_period_end" date NOT NULL,
  "verified_at" timestamp,
  "disputed_at" timestamp,
  "dispute_reason" text,
  "reported_total_hours" numeric(10, 2),
  "reported_gross_pay" numeric(10, 2),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "payroll_period_verifications"
    ADD CONSTRAINT "payroll_period_verifications_caregiver_id_users_id_fk"
    FOREIGN KEY ("caregiver_id") REFERENCES "users"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payroll_period_verifications_caregiver_period_idx" ON "payroll_period_verifications" ("caregiver_id", "pay_period_start", "pay_period_end");
--> statement-breakpoint

-- ── Training records + certifications: the CVHC fields the compliance screens read ──
ALTER TABLE "training_records" ADD COLUMN IF NOT EXISTS "certification_number" text;
--> statement-breakpoint
ALTER TABLE "training_records" ADD COLUMN IF NOT EXISTS "recorded_by_id" text;
--> statement-breakpoint
ALTER TABLE "training_records" ADD COLUMN IF NOT EXISTS "updated_at" timestamp DEFAULT now() NOT NULL;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "training_records"
    ADD CONSTRAINT "training_records_recorded_by_id_users_id_fk"
    FOREIGN KEY ("recorded_by_id") REFERENCES "users"("id");
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "training_records_expiry_idx" ON "training_records" ("expiry_date");
--> statement-breakpoint
ALTER TABLE "certification_records" ADD COLUMN IF NOT EXISTS "certification_number" text;
