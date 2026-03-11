-- Combined migration: CVHC CRM migrations v12 through v19
-- Safe to run on both fresh and existing databases (all statements use IF NOT EXISTS / IF EXISTS)

-- ═══════════════════════════════════════════════════════════════════════════════
-- FROM migration_v12: Schema ordering fixes
-- ═══════════════════════════════════════════════════════════════════════════════

-- Ensure caregiver_profiles has extended columns
ALTER TABLE caregiver_profiles ADD COLUMN IF NOT EXISTS taxonomy_code VARCHAR(20) DEFAULT '374700000X';
ALTER TABLE caregiver_profiles ADD COLUMN IF NOT EXISTS evv_worker_id VARCHAR(100);
ALTER TABLE caregiver_profiles ADD COLUMN IF NOT EXISTS medicaid_provider_id VARCHAR(100);

-- Ensure care_types has service code columns
ALTER TABLE care_types ADD COLUMN IF NOT EXISTS default_service_code VARCHAR(20);
ALTER TABLE care_types ADD COLUMN IF NOT EXISTS default_modifier VARCHAR(10);
ALTER TABLE care_types ADD COLUMN IF NOT EXISTS requires_evv BOOLEAN DEFAULT true;

-- Ensure schedules has all columns
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'active';
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS date DATE;
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS care_type_id TEXT;

-- Ensure open_shifts has extended columns
ALTER TABLE open_shifts ADD COLUMN IF NOT EXISTS source_absence_id TEXT;
ALTER TABLE open_shifts ADD COLUMN IF NOT EXISTS notified_caregiver_count INTEGER DEFAULT 0;
ALTER TABLE open_shifts ADD COLUMN IF NOT EXISTS auto_created BOOLEAN DEFAULT false;

-- Ensure authorizations has referral_source_id
ALTER TABLE authorizations ADD COLUMN IF NOT EXISTS referral_source_id TEXT;
UPDATE authorizations SET payer_id = referral_source_id
WHERE payer_id IS NULL AND referral_source_id IS NOT NULL;

-- Ensure background_checks has all columns
ALTER TABLE background_checks ADD COLUMN IF NOT EXISTS check_type VARCHAR(100);
ALTER TABLE background_checks ADD COLUMN IF NOT EXISTS provider VARCHAR(100);
ALTER TABLE background_checks ADD COLUMN IF NOT EXISTS cost DECIMAL(8,2);
ALTER TABLE background_checks ADD COLUMN IF NOT EXISTS initiated_date DATE;
ALTER TABLE background_checks ADD COLUMN IF NOT EXISTS expiration_date DATE;
ALTER TABLE background_checks ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE background_checks ADD COLUMN IF NOT EXISTS created_by TEXT;
ALTER TABLE background_checks ADD COLUMN IF NOT EXISTS submitted_date DATE;
ALTER TABLE background_checks ADD COLUMN IF NOT EXISTS completed_date DATE;
ALTER TABLE background_checks ADD COLUMN IF NOT EXISTS result VARCHAR(50);
ALTER TABLE background_checks ADD COLUMN IF NOT EXISTS reference_number VARCHAR(255);
ALTER TABLE background_checks ADD COLUMN IF NOT EXISTS findings TEXT;

-- Ensure audit_logs has required columns
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS is_sensitive BOOLEAN DEFAULT false;

-- ═══════════════════════════════════════════════════════════════════════════════
-- FROM migration_v13: Missing columns and tables
-- ═══════════════════════════════════════════════════════════════════════════════

-- Open shifts timestamp columns
ALTER TABLE open_shifts ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;
ALTER TABLE open_shifts ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE open_shifts ADD COLUMN IF NOT EXISTS approved_by TEXT;
ALTER TABLE open_shifts ADD COLUMN IF NOT EXISTS claimed_by TEXT;
ALTER TABLE open_shifts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE open_shifts ADD COLUMN IF NOT EXISTS broadcast_sent BOOLEAN DEFAULT false;

-- Claims accepted_date
ALTER TABLE claims ADD COLUMN IF NOT EXISTS accepted_date DATE;

-- Caregiver availability: per-day columns
ALTER TABLE caregiver_availability ADD COLUMN IF NOT EXISTS sunday_available BOOLEAN DEFAULT false;
ALTER TABLE caregiver_availability ADD COLUMN IF NOT EXISTS sunday_start_time TIME;
ALTER TABLE caregiver_availability ADD COLUMN IF NOT EXISTS sunday_end_time TIME;
ALTER TABLE caregiver_availability ADD COLUMN IF NOT EXISTS monday_available BOOLEAN DEFAULT true;
ALTER TABLE caregiver_availability ADD COLUMN IF NOT EXISTS monday_start_time TIME;
ALTER TABLE caregiver_availability ADD COLUMN IF NOT EXISTS monday_end_time TIME;
ALTER TABLE caregiver_availability ADD COLUMN IF NOT EXISTS tuesday_available BOOLEAN DEFAULT true;
ALTER TABLE caregiver_availability ADD COLUMN IF NOT EXISTS tuesday_start_time TIME;
ALTER TABLE caregiver_availability ADD COLUMN IF NOT EXISTS tuesday_end_time TIME;
ALTER TABLE caregiver_availability ADD COLUMN IF NOT EXISTS wednesday_available BOOLEAN DEFAULT true;
ALTER TABLE caregiver_availability ADD COLUMN IF NOT EXISTS wednesday_start_time TIME;
ALTER TABLE caregiver_availability ADD COLUMN IF NOT EXISTS wednesday_end_time TIME;
ALTER TABLE caregiver_availability ADD COLUMN IF NOT EXISTS thursday_available BOOLEAN DEFAULT true;
ALTER TABLE caregiver_availability ADD COLUMN IF NOT EXISTS thursday_start_time TIME;
ALTER TABLE caregiver_availability ADD COLUMN IF NOT EXISTS thursday_end_time TIME;
ALTER TABLE caregiver_availability ADD COLUMN IF NOT EXISTS friday_available BOOLEAN DEFAULT true;
ALTER TABLE caregiver_availability ADD COLUMN IF NOT EXISTS friday_start_time TIME;
ALTER TABLE caregiver_availability ADD COLUMN IF NOT EXISTS friday_end_time TIME;
ALTER TABLE caregiver_availability ADD COLUMN IF NOT EXISTS saturday_available BOOLEAN DEFAULT false;
ALTER TABLE caregiver_availability ADD COLUMN IF NOT EXISTS saturday_start_time TIME;
ALTER TABLE caregiver_availability ADD COLUMN IF NOT EXISTS saturday_end_time TIME;

-- Care types: required certifications
ALTER TABLE care_types ADD COLUMN IF NOT EXISTS required_certifications JSONB DEFAULT '[]';

-- Client visit notes table
CREATE TABLE IF NOT EXISTS client_visit_notes (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  caregiver_id TEXT REFERENCES users(id),
  note TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_visit_notes_client ON client_visit_notes(client_id);

-- Client services table
CREATE TABLE IF NOT EXISTS client_services (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  service_pricing_id TEXT NOT NULL,
  is_primary BOOLEAN DEFAULT false,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_client_services_client ON client_services(client_id);

-- Client portal: scheduled visits
CREATE TABLE IF NOT EXISTS scheduled_visits (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  caregiver_id TEXT REFERENCES users(id),
  visit_date DATE NOT NULL,
  scheduled_date DATE,
  start_time TIME,
  end_time TIME,
  status VARCHAR(50) DEFAULT 'scheduled',
  notes TEXT,
  cancelled_reason TEXT,
  cancelled_by TEXT REFERENCES users(id),
  cancelled_at TIMESTAMPTZ,
  assignment_id TEXT,
  created_by TEXT REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_scheduled_visits_client ON scheduled_visits(client_id);

-- Client notification preferences (boolean columns)
CREATE TABLE IF NOT EXISTS client_notification_preferences (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  email_enabled BOOLEAN DEFAULT true,
  portal_enabled BOOLEAN DEFAULT true,
  caregiver_alerts BOOLEAN DEFAULT true,
  schedule_alerts BOOLEAN DEFAULT true,
  billing_alerts BOOLEAN DEFAULT true,
  assignment_alerts BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(client_id)
);

-- Referral sources billing columns
ALTER TABLE referral_sources ADD COLUMN IF NOT EXISTS billing_address TEXT;
ALTER TABLE referral_sources ADD COLUMN IF NOT EXISTS billing_contact VARCHAR(255);

-- User status column
ALTER TABLE users ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'active';

-- Client status column
ALTER TABLE clients ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'active';

-- Caregiver profiles SMS preferences
ALTER TABLE caregiver_profiles ADD COLUMN IF NOT EXISTS sms_enabled BOOLEAN DEFAULT true;
ALTER TABLE caregiver_profiles ADD COLUMN IF NOT EXISTS sms_open_shifts BOOLEAN DEFAULT true;

-- ═══════════════════════════════════════════════════════════════════════════════
-- FROM migration_v14: Client and portal enhancements
-- ═══════════════════════════════════════════════════════════════════════════════

-- Client scheduling columns
ALTER TABLE clients ADD COLUMN IF NOT EXISTS emergency_contact_name VARCHAR(255);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS emergency_contact_phone VARCHAR(50);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS emergency_contact_relationship VARCHAR(100);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS medical_notes TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS care_preferences TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS mobility_assistance_needs TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS billing_notes TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS service_days_per_week INTEGER DEFAULT 5;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS service_allowed_days JSONB DEFAULT '[1,2,3,4,5]';

-- Notifications columns
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS recipient_type VARCHAR(50);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS recipient_id TEXT;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS notification_type VARCHAR(100);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS subject VARCHAR(255);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'sent';
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS sent_by TEXT;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Client notifications: relational columns
ALTER TABLE client_notifications ADD COLUMN IF NOT EXISTS related_visit_id TEXT;
ALTER TABLE client_notifications ADD COLUMN IF NOT EXISTS related_invoice_id TEXT;
ALTER TABLE client_notifications ADD COLUMN IF NOT EXISTS related_caregiver_id TEXT;

-- ═══════════════════════════════════════════════════════════════════════════════
-- FROM migration_v15: Care plans and billing enhancements
-- ═══════════════════════════════════════════════════════════════════════════════

-- Care plans status
ALTER TABLE care_plans ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'active';

-- ═══════════════════════════════════════════════════════════════════════════════
-- FROM migration_v16: Claims & Billing Engine
-- ═══════════════════════════════════════════════════════════════════════════════

-- Claims: full billing engine columns
ALTER TABLE claims ADD COLUMN IF NOT EXISTS caregiver_id TEXT;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS submission_method VARCHAR(50);
ALTER TABLE claims ADD COLUMN IF NOT EXISTS edi_file_path VARCHAR(500);
ALTER TABLE claims ADD COLUMN IF NOT EXISTS clearinghouse_id VARCHAR(100);
ALTER TABLE claims ADD COLUMN IF NOT EXISTS denial_code VARCHAR(50);
ALTER TABLE claims ADD COLUMN IF NOT EXISTS eob_notes TEXT;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS check_number VARCHAR(100);
ALTER TABLE claims ADD COLUMN IF NOT EXISTS units_billed DECIMAL(10,2);
ALTER TABLE claims ADD COLUMN IF NOT EXISTS payer_type VARCHAR(50);
ALTER TABLE claims ADD COLUMN IF NOT EXISTS resubmitted_from TEXT;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS voided_by TEXT;

CREATE INDEX IF NOT EXISTS idx_claims_denial ON claims(status, created_at DESC) WHERE status = 'denied';
CREATE INDEX IF NOT EXISTS idx_claims_payer_status ON claims(payer_id, status);
CREATE INDEX IF NOT EXISTS idx_claims_caregiver ON claims(caregiver_id);
CREATE INDEX IF NOT EXISTS idx_claims_service_date ON claims(service_date);

-- Payments table
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  payer_id TEXT REFERENCES referral_sources(id),
  payer_name VARCHAR(255),
  check_number VARCHAR(100),
  check_date DATE,
  check_amount DECIMAL(12,2) NOT NULL,
  payment_date DATE DEFAULT CURRENT_DATE,
  payment_method VARCHAR(50) DEFAULT 'check',
  scan_image_path VARCHAR(500),
  ai_extracted_data JSONB,
  reconciliation_status VARCHAR(30) DEFAULT 'unreconciled',
  reconciliation_notes TEXT,
  total_matched DECIMAL(12,2) DEFAULT 0,
  underpayment_amount DECIMAL(12,2) DEFAULT 0,
  overpayment_amount DECIMAL(12,2) DEFAULT 0,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payments_payer ON payments(payer_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(reconciliation_status);
CREATE INDEX IF NOT EXISTS idx_payments_date ON payments(payment_date DESC);

-- Payment-claim matches
CREATE TABLE IF NOT EXISTS payment_claim_matches (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  claim_id TEXT NOT NULL REFERENCES claims(id),
  matched_amount DECIMAL(12,2) NOT NULL,
  match_type VARCHAR(30) DEFAULT 'auto',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pcm_payment ON payment_claim_matches(payment_id);
CREATE INDEX IF NOT EXISTS idx_pcm_claim ON payment_claim_matches(claim_id);

-- Denial codes reference table
CREATE TABLE IF NOT EXISTS denial_code_lookup (
  code VARCHAR(10) PRIMARY KEY,
  description TEXT NOT NULL,
  category VARCHAR(50),
  common_fix TEXT
);

INSERT INTO denial_code_lookup (code, description, category, common_fix) VALUES
  ('CO-4', 'Procedure code inconsistent with modifier or missing modifier', 'coding', 'Verify procedure code and modifier match authorization'),
  ('CO-16', 'Claim/service lacks information needed for adjudication', 'missing_info', 'Resubmit with complete claim information'),
  ('CO-18', 'Exact duplicate claim/service', 'duplicate', 'Verify this is not a duplicate before resubmitting'),
  ('CO-22', 'Care may be covered by another payer', 'coordination', 'Verify coordination of benefits and primary payer'),
  ('CO-27', 'Expenses incurred after coverage terminated', 'eligibility', 'Verify member eligibility dates'),
  ('CO-29', 'Time limit for filing has expired', 'timely_filing', 'File appeal with proof of timely submission'),
  ('CO-45', 'Charges exceed fee schedule/max allowable', 'pricing', 'Adjust charges to fee schedule rates'),
  ('CO-50', 'Non-covered services (not deemed medically necessary)', 'medical_necessity', 'Submit with supporting documentation'),
  ('CO-96', 'Non-covered charge(s)', 'coverage', 'Verify service is covered under member plan'),
  ('CO-97', 'Payment adjusted: benefit for this service is in another claim', 'bundling', 'Check for bundled services'),
  ('CO-109', 'Claim not covered by this payer', 'wrong_payer', 'Route to correct payer'),
  ('CO-197', 'Precertification/authorization absent', 'auth', 'Obtain and attach prior authorization number'),
  ('CO-252', 'Service not authorized on date(s) of service', 'auth', 'Verify authorization covers the service dates'),
  ('PR-1', 'Deductible amount', 'patient_resp', 'Bill patient for deductible amount'),
  ('PR-2', 'Coinsurance amount', 'patient_resp', 'Bill patient for coinsurance'),
  ('PR-3', 'Co-payment amount', 'patient_resp', 'Collect co-payment from patient')
ON CONFLICT (code) DO NOTHING;

-- Authorizations: enhanced burn-down tracking
ALTER TABLE authorizations ADD COLUMN IF NOT EXISTS authorized_units DECIMAL(10,2);
ALTER TABLE authorizations ADD COLUMN IF NOT EXISTS unit_type VARCHAR(20) DEFAULT '15min';
ALTER TABLE authorizations ADD COLUMN IF NOT EXISTS renewal_requested BOOLEAN DEFAULT false;
ALTER TABLE authorizations ADD COLUMN IF NOT EXISTS renewal_requested_at TIMESTAMPTZ;
ALTER TABLE authorizations ADD COLUMN IF NOT EXISTS renewal_requested_by TEXT;

-- Referral sources: FEA org for IRIS routing
ALTER TABLE referral_sources ADD COLUMN IF NOT EXISTS fea_organization VARCHAR(100);
ALTER TABLE referral_sources ADD COLUMN IF NOT EXISTS payer_id_number VARCHAR(100);

-- EDI batches file path
ALTER TABLE edi_batches ADD COLUMN IF NOT EXISTS file_path VARCHAR(500);

-- ═══════════════════════════════════════════════════════════════════════════════
-- FROM migration_v17: Split Shift Support
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE schedules ADD COLUMN IF NOT EXISTS is_split_shift BOOLEAN DEFAULT FALSE;
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS split_shift_group_id TEXT;
ALTER TABLE schedules ADD COLUMN IF NOT EXISTS split_segment INTEGER;

CREATE INDEX IF NOT EXISTS idx_schedules_split_group ON schedules(split_shift_group_id) WHERE split_shift_group_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════════════
-- FROM migration_v18: Preferred Working Hours
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE caregiver_availability
  ADD COLUMN IF NOT EXISTS monday_preferred_start TIME,
  ADD COLUMN IF NOT EXISTS monday_preferred_end TIME,
  ADD COLUMN IF NOT EXISTS tuesday_preferred_start TIME,
  ADD COLUMN IF NOT EXISTS tuesday_preferred_end TIME,
  ADD COLUMN IF NOT EXISTS wednesday_preferred_start TIME,
  ADD COLUMN IF NOT EXISTS wednesday_preferred_end TIME,
  ADD COLUMN IF NOT EXISTS thursday_preferred_start TIME,
  ADD COLUMN IF NOT EXISTS thursday_preferred_end TIME,
  ADD COLUMN IF NOT EXISTS friday_preferred_start TIME,
  ADD COLUMN IF NOT EXISTS friday_preferred_end TIME,
  ADD COLUMN IF NOT EXISTS saturday_preferred_start TIME,
  ADD COLUMN IF NOT EXISTS saturday_preferred_end TIME,
  ADD COLUMN IF NOT EXISTS sunday_preferred_start TIME,
  ADD COLUMN IF NOT EXISTS sunday_preferred_end TIME;

-- ═══════════════════════════════════════════════════════════════════════════════
-- FROM migration_v19: Password Reset Tokens
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS reset_token VARCHAR(255),
  ADD COLUMN IF NOT EXISTS reset_token_expires TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_users_reset_token ON users(reset_token) WHERE reset_token IS NOT NULL;
