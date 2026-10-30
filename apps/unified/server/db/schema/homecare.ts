// Home-care add-on (docs/UNIFIED_HOMECARE_PLAN.md): clients and care plans, caregivers and scheduling, EVV and IVR,
// authorizations, visit billing, claims, EDI and remittance, payroll, HR and onboarding, the family portal, incidents
// and compliance. Column for column from templates/crm-homecare/backend/db/schema.ts, with: company_id on every table
// (one agency per database needed none); agencies → company and users → user; the standard id (the two logs keyed on
// their columns keep them as a unique index); incident numbers per company and year; names kept as they were.
import { pgTable, pgSequence, text, boolean, integer, bigint, decimal, timestamp, date, time, json, uniqueIndex, index, check } from 'drizzle-orm/pg-core'
import { scheduleActiveRecurring, scheduleStartClock, scheduleEndClock, timeEntryOpen, scheduleIsTraining, scheduleSuspended, timeEntryNeedsApproval, invoiceSeqNext } from '../../data/indexWhere.ts'
import { createId } from '@paralleldrive/cuid2'
import { company, user } from './core.ts'
import { lead } from './crm.ts'
import { clientsInsuranceFrontSizeCap, clientsInsuranceBackSizeCap, clientTaskTemplatesCategoryCheck, clientTaskTemplatesTimeOfDayCheck, clientTaskTemplatesCadenceCheck, shiftTaskCompletionsStatusCheck, vitalsSystolicRange, vitalsDiastolicRange, vitalsPulseRange, vitalsRespRange, vitalsO2Range, vitalsTempRange, vitalsGlucoseRange, vitalsWeightRange, vitalsPainRange, documentsEntityTypeCheck } from '../../data/homecareChecks.ts'

export const caregiverProfiles = pgTable('caregiver_profiles', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  caregiverId: text('caregiver_id').notNull().unique().references(() => user.id, { onDelete: 'cascade' }),
  notes: text('notes'),
  capabilities: text('capabilities'),
  // Item 5 (care_match_prefs): what the matcher compares to a client's gender and language preferences.
  gender: text('gender'),
  languages: text('languages'),
  limitations: text('limitations'),
  preferredHours: text('preferred_hours'),
  availableMon: boolean('available_mon').default(true).notNull(),
  availableTue: boolean('available_tue').default(true).notNull(),
  availableWed: boolean('available_wed').default(true).notNull(),
  availableThu: boolean('available_thu').default(true).notNull(),
  availableFri: boolean('available_fri').default(true).notNull(),
  availableSat: boolean('available_sat').default(false).notNull(),
  availableSun: boolean('available_sun').default(false).notNull(),
  npiNumber: text('npi_number'),
  taxonomyCode: text('taxonomy_code').default('374700000X'),
  evvWorkerId: text('evv_worker_id'),
  medicaidProviderId: text('medicaid_provider_id'),
  // 0005 (CVHC v13); declared so the boot's `drizzle-kit push` never drops them.
  smsEnabled: boolean('sms_enabled').default(true),
  smsOpenShifts: boolean('sms_open_shifts').default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('caregiver_profiles_company_id_idx').on(t.companyId),
])

export const caregiverAvailability = pgTable('caregiver_availability', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  caregiverId: text('caregiver_id').notNull().unique().references(() => user.id, { onDelete: 'cascade' }),
  status: text('status').default('available').notNull(),
  maxHoursPerWeek: integer('max_hours_per_week').default(40).notNull(),
  weeklyAvailability: json('weekly_availability'),
  notes: text('notes'),
  // Per-day availability
  mondayAvailable: boolean('monday_available').default(true),
  mondayStartTime: time('monday_start_time'),
  mondayEndTime: time('monday_end_time'),
  tuesdayAvailable: boolean('tuesday_available').default(true),
  tuesdayStartTime: time('tuesday_start_time'),
  tuesdayEndTime: time('tuesday_end_time'),
  wednesdayAvailable: boolean('wednesday_available').default(true),
  wednesdayStartTime: time('wednesday_start_time'),
  wednesdayEndTime: time('wednesday_end_time'),
  thursdayAvailable: boolean('thursday_available').default(true),
  thursdayStartTime: time('thursday_start_time'),
  thursdayEndTime: time('thursday_end_time'),
  fridayAvailable: boolean('friday_available').default(true),
  fridayStartTime: time('friday_start_time'),
  fridayEndTime: time('friday_end_time'),
  saturdayAvailable: boolean('saturday_available').default(false),
  saturdayStartTime: time('saturday_start_time'),
  saturdayEndTime: time('saturday_end_time'),
  sundayAvailable: boolean('sunday_available').default(false),
  sundayStartTime: time('sunday_start_time'),
  sundayEndTime: time('sunday_end_time'),
  // Preferred hours (optimizer tries these first, falls back to full window)
  mondayPreferredStart: time('monday_preferred_start'),
  mondayPreferredEnd: time('monday_preferred_end'),
  tuesdayPreferredStart: time('tuesday_preferred_start'),
  tuesdayPreferredEnd: time('tuesday_preferred_end'),
  wednesdayPreferredStart: time('wednesday_preferred_start'),
  wednesdayPreferredEnd: time('wednesday_preferred_end'),
  thursdayPreferredStart: time('thursday_preferred_start'),
  thursdayPreferredEnd: time('thursday_preferred_end'),
  fridayPreferredStart: time('friday_preferred_start'),
  fridayPreferredEnd: time('friday_preferred_end'),
  saturdayPreferredStart: time('saturday_preferred_start'),
  saturdayPreferredEnd: time('saturday_preferred_end'),
  sundayPreferredStart: time('sunday_preferred_start'),
  sundayPreferredEnd: time('sunday_preferred_end'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('caregiver_availability_company_id_idx').on(t.companyId),
])

export const caregiverSchedules = pgTable('caregiver_schedules', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  caregiverId: text('caregiver_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  dayOfWeek: integer('day_of_week'),
  date: date('date'),
  startTime: time('start_time'),
  endTime: time('end_time'),
  isAvailable: boolean('is_available').default(true).notNull(),
  maxHoursPerWeek: integer('max_hours_per_week').default(40).notNull(),
  overtimeApproved: boolean('overtime_approved').default(false).notNull(),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('caregiver_schedules_company_id_idx').on(t.companyId),
  index('caregiver_schedules_caregiver_id_idx').on(t.caregiverId),
  index('caregiver_schedules_date_idx').on(t.date),
])

export const caregiverTimeOff = pgTable('caregiver_time_off', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  caregiverId: text('caregiver_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  startDate: date('start_date').notNull(),
  endDate: date('end_date').notNull(),
  type: text('type').notNull(),
  reason: text('reason'),
  approvedById: text('approved_by_id'),
  status: text('status').default('pending').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('caregiver_time_off_company_id_idx').on(t.companyId),
  index('caregiver_time_off_caregiver_id_idx').on(t.caregiverId),
  index('caregiver_time_off_dates_idx').on(t.startDate, t.endDate),
])

export const referralSources = pgTable('referral_sources', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  type: text('type'),
  contactName: text('contact_name'),
  email: text('email'),
  phone: text('phone'),
  address: text('address'),
  city: text('city'),
  state: text('state'),
  zip: text('zip'),
  notes: text('notes'),
  isActive: boolean('is_active').default(true).notNull(),
  payerType: text('payer_type').default('other'),
  payerIdNumber: text('payer_id_number'),
  npi: text('npi'),
  expectedPayDays: integer('expected_pay_days').default(30),
  isActivePayer: boolean('is_active_payer').default(false).notNull(),
  ediPayerId: text('edi_payer_id'),
  submissionMethod: text('submission_method').default('manual'),
  feaOrganization: text('fea_organization'),
  billingAddress: text('billing_address'),
  // 0005 (CVHC v13); declared so the boot's `drizzle-kit push` never drops it.
  billingContact: text('billing_contact'),
  billingContactName: text('billing_contact_name'),
  billingContactEmail: text('billing_contact_email'),
  billingContactPhone: text('billing_contact_phone'),
  // EVV / Sandata (0014_evv): this payer's Sandata codes, and whether its clients are in Sandata
  // (caregivers are then prompted to check in/out on Sandata Mobile Connect).
  sandataPayerId: text('sandata_payer_id'),
  sandataPayerProgram: text('sandata_payer_program'),
  sandataEvvRequired: boolean('sandata_evv_required').default(false).notNull(),
  // Billing port (0015): this payer's insurer-portal export, e.g. My Choice Wisconsin's MIDAS —
  // { name, evvCode, evvLabel, otherCode, otherLabel }. NULL = no portal export for this payer.
  claimPortal: json('claim_portal'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('referral_sources_company_id_idx').on(t.companyId),
  index('referral_sources_type_idx').on(t.type),
  index('referral_sources_is_active_idx').on(t.isActive),
  index('referral_sources_active_type_idx').on(t.isActive, t.type),
])

export const clients = pgTable('clients', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  firstName: text('first_name').notNull(),
  lastName: text('last_name').notNull(),
  dateOfBirth: date('date_of_birth'),
  ssnEncrypted: text('ssn_encrypted'),
  gender: text('gender'),
  // Item 5 (care_match_prefs): what this client needs from a caregiver — skills (a comma list), a gender, a language.
  requiredSkills: text('required_skills'),
  preferredCaregiverGender: text('preferred_caregiver_gender'),
  preferredLanguage: text('preferred_language'),
  // Item 11 (care_supervisory_visits): this client's own days between supervisory visits; NULL = the agency's rule, 0 = none needed.
  supervisoryIntervalDays: integer('supervisory_interval_days'),
  address: text('address'),
  city: text('city'),
  state: text('state'),
  zip: text('zip'),
  phone: text('phone'),
  email: text('email'),
  referredById: text('referred_by_id').references(() => referralSources.id),
  referralDate: date('referral_date'),
  startDate: date('start_date'),
  isActive: boolean('is_active').default(true).notNull(),
  serviceType: text('service_type'),
  insuranceProvider: text('insurance_provider'),
  insuranceId: text('insurance_id'),
  insuranceGroup: text('insurance_group'),
  medicalConditions: json('medical_conditions').default([]).notNull(),
  allergies: json('allergies').default([]).notNull(),
  medications: json('medications').default([]).notNull(),
  preferredCaregivers: json('preferred_caregivers').default([]).notNull(),
  doNotUseCaregivers: json('do_not_use_caregivers').default([]).notNull(),
  notes: text('notes'),
  evvClientId: text('evv_client_id'),
  mcoMemberId: text('mco_member_id'),
  primaryDiagnosisCode: text('primary_diagnosis_code'),
  secondaryDiagnosisCode: text('secondary_diagnosis_code'),
  // Billing & authorization fields
  careTypeId: text('care_type_id'),
  isPrivatePay: boolean('is_private_pay').default(false).notNull(),
  privatePayRate: decimal('private_pay_rate', { precision: 8, scale: 2 }),
  privatePayRateType: text('private_pay_rate_type').default('hourly'),
  weeklyAuthorizedUnits: decimal('weekly_authorized_units', { precision: 8, scale: 2 }),
  serviceDaysPerWeek: integer('service_days_per_week'),
  serviceAllowedDays: json('service_allowed_days'),
  assistanceNeeds: text('assistance_needs'),
  billingNotes: text('billing_notes'),
  // Edit Client's "Medical notes" / "Care preferences", shown on the caregiver's client card (0023_fixes).
  medicalNotes: text('medical_notes'),
  carePreferences: text('care_preferences'),
  // 0005 (CVHC v13/v14) created these on every agency; declared so the boot's `drizzle-kit push` never drops them.
  status: text('status').default('active'),
  emergencyContactName: text('emergency_contact_name'),
  emergencyContactPhone: text('emergency_contact_phone'),
  emergencyContactRelationship: text('emergency_contact_relationship'),
  mobilityAssistanceNeeds: text('mobility_assistance_needs'),
  // Billing port (0015, CVHC v62): invoice cadence in weeks (1-8; NULL = manual only) and the last
  // day already covered by an invoice — "Create Due Invoices" resumes the day after.
  billingFrequencyWeeks: integer('billing_frequency_weeks'),
  billedThrough: date('billed_through'),
  latitude: decimal('latitude', { precision: 10, scale: 8 }),
  longitude: decimal('longitude', { precision: 11, scale: 8 }),
  ivrCode: text('ivr_code').unique(),
  medicaidId: text('medicaid_id'),
  // Portal access fields
  portalEnabled: boolean('portal_enabled').default(false).notNull(),
  portalToken: text('portal_token'),
  portalTokenExp: timestamp('portal_token_exp'),
  lastPortalVisit: timestamp('last_portal_visit'),
  portalEmail: text('portal_email'),
  portalPasswordHash: text('portal_password_hash'),
  // EVV / Sandata (0014_evv): client-record sync state, and EVV units per Sun–Sat week
  // (1 unit = 15 min; null = not entered, 0 = no EVV hours).
  sandataSequence: bigint('sandata_sequence', { mode: 'number' }).default(0),
  sandataSyncedAt: timestamp('sandata_synced_at'),
  evvWeeklyUnits: integer('evv_weekly_units'),
  // Insurance card photos (front/back), base64 data URIs, ~5 MB raw each. (care, 0017)
  insuranceCardFront: text('insurance_card_front'),
  insuranceCardBack: text('insurance_card_back'),
  insuranceCardUploadedAt: timestamp('insurance_card_uploaded_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('clients_company_id_idx').on(t.companyId),
  index('clients_is_active_idx').on(t.isActive),
  index('clients_referred_by_id_idx').on(t.referredById),
  index('clients_active_service_idx').on(t.isActive, t.serviceType),
  check('clients_insurance_front_size_cap', clientsInsuranceFrontSizeCap(t)),
  check('clients_insurance_back_size_cap', clientsInsuranceBackSizeCap(t)),
])

export const clientEmergencyContacts = pgTable('client_emergency_contacts', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  clientId: text('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  relationship: text('relationship'),
  phone: text('phone').notNull(),
  email: text('email'),
  isPrimary: boolean('is_primary').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('client_emergency_contacts_company_id_idx').on(t.companyId),
  index('client_emergency_contacts_client_id_idx').on(t.clientId),
])

export const clientOnboarding = pgTable('client_onboarding', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  clientId: text('client_id').notNull().unique().references(() => clients.id, { onDelete: 'cascade' }),
  emergencyContactsCompleted: boolean('emergency_contacts_completed').default(false).notNull(),
  medicalHistoryCompleted: boolean('medical_history_completed').default(false).notNull(),
  insuranceInfoCompleted: boolean('insurance_info_completed').default(false).notNull(),
  carePreferencesCompleted: boolean('care_preferences_completed').default(false).notNull(),
  familyCommunicationCompleted: boolean('family_communication_completed').default(false).notNull(),
  initialAssessmentCompleted: boolean('initial_assessment_completed').default(false).notNull(),
  allCompleted: boolean('all_completed').default(false).notNull(),
  completedAt: timestamp('completed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('client_onboarding_company_id_idx').on(t.companyId),
])

export const clientAssignments = pgTable('client_assignments', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  clientId: text('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
  caregiverId: text('caregiver_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  assignmentDate: date('assignment_date').notNull(),
  hoursPerWeek: decimal('hours_per_week', { precision: 5, scale: 2 }),
  payRate: decimal('pay_rate', { precision: 10, scale: 2 }),
  status: text('status').default('active').notNull(),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('client_assignments_company_id_idx').on(t.companyId),
  index('client_assignments_client_id_idx').on(t.clientId),
  index('client_assignments_caregiver_id_idx').on(t.caregiverId),
  index('client_assignments_status_idx').on(t.status),
])

export const schedules = pgTable('schedules', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  clientId: text('client_id'),
  caregiverId: text('caregiver_id'),
  title: text('title'),
  startTime: timestamp('start_time'),
  endTime: timestamp('end_time'),
  frequency: text('frequency').default('weekly').notNull(),
  effectiveDate: date('effective_date'),
  anchorDate: date('anchor_date'),
  scheduleType: text('schedule_type').default('recurring').notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  dayOfWeek: integer('day_of_week'),
  date: date('date'),
  status: text('status').default('active'),
  notes: text('notes'),
  careTypeId: text('care_type_id'),
  endDate: date('end_date'),
  // Split shift support
  isSplitShift: boolean('is_split_shift').default(false),
  splitShiftGroupId: text('split_shift_group_id'),
  splitSegment: integer('split_segment'),
  // Training shift (0016_visits): the trainee is paid through payroll, the client is never billed for it.
  isTraining: boolean('is_training').default(false).notNull(),
  // Suspended service (0016_visits): no occurrence on/after this date is generated. NULL = active.
  suspendedFrom: date('suspended_from'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('schedules_company_id_idx').on(t.companyId),
  index('schedules_client_id_idx').on(t.clientId),
  index('schedules_caregiver_id_idx').on(t.caregiverId),
  index('schedules_split_group_idx').on(t.splitShiftGroupId),
  // One active recurring pattern per caregiver, client, weekday and clock time (template 0016_visits.sql).
  uniqueIndex('uniq_active_recurring_schedule').on(t.caregiverId, t.clientId, t.dayOfWeek, scheduleStartClock, scheduleEndClock).where(scheduleActiveRecurring),
  index('idx_schedules_is_training').on(t.isTraining).where(scheduleIsTraining),
  index('idx_schedules_suspended_from').on(t.suspendedFrom).where(scheduleSuspended),
])

export const openShifts = pgTable('open_shifts', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  clientId: text('client_id'),
  date: date('date').notNull(),
  startTime: time('start_time'),
  endTime: time('end_time'),
  status: text('status').default('open').notNull(),
  notes: text('notes'),
  sourceAbsenceId: text('source_absence_id'),
  notifiedCaregiverCount: integer('notified_caregiver_count').default(0).notNull(),
  autoCreated: boolean('auto_created').default(false).notNull(),
  createdById: text('created_by_id').references(() => user.id),
  // 0016_visits — the visit behind the posting, the pay offer, and who took it.
  scheduleId: text('schedule_id').references(() => schedules.id, { onDelete: 'set null' }),
  careTypeId: text('care_type_id'),
  hourlyRate: decimal('hourly_rate', { precision: 10, scale: 2 }),
  bonusAmount: decimal('bonus_amount', { precision: 10, scale: 2 }).default('0'),
  urgency: text('urgency').default('normal'),
  claimedById: text('claimed_by_id').references(() => user.id, { onDelete: 'set null' }),
  claimedAt: timestamp('claimed_at'),
  approvedById: text('approved_by_id').references(() => user.id, { onDelete: 'set null' }),
  approvedAt: timestamp('approved_at'),
  // 0005 (CVHC v13) spellings of who took / approved it; declared so `drizzle-kit push` never drops them.
  claimedBy: text('claimed_by'),
  approvedBy: text('approved_by'),
  broadcastSent: boolean('broadcast_sent').default(false).notNull(),
  // The caregivers the office offered it to (NULL = everyone); the first of them to accept gets it.
  visibleTo: text('visible_to').array(),
  autoAssign: boolean('auto_assign').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('open_shifts_company_id_idx').on(t.companyId),
  index('open_shifts_date_idx').on(t.date),
  index('open_shifts_status_idx').on(t.status),
  index('open_shifts_schedule_id_idx').on(t.scheduleId),
])

export const openShiftNotifications = pgTable('open_shift_notifications', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  openShiftId: text('open_shift_id').notNull().references(() => openShifts.id, { onDelete: 'cascade' }),
  caregiverId: text('caregiver_id').notNull(),
  notifiedAt: timestamp('notified_at').defaultNow().notNull(),
  notificationType: text('notification_type').default('push').notNull(),
}, (t) => [
  index('open_shift_notifications_company_id_idx').on(t.companyId),
  uniqueIndex('open_shift_notifications_shift_caregiver_idx').on(t.openShiftId, t.caregiverId),
  index('open_shift_notifications_open_shift_id_idx').on(t.openShiftId),
])

export const absences = pgTable('absences', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  caregiverId: text('caregiver_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  clientId: text('client_id').references(() => clients.id),
  date: date('date').notNull(),
  type: text('type').notNull(),
  reason: text('reason'),
  reportedById: text('reported_by_id').references(() => user.id),
  coverageNeeded: boolean('coverage_needed').default(true).notNull(),
  coverageAssignedTo: text('coverage_assigned_to').references(() => user.id),
  notes: text('notes'),
  status: text('status').default('reported').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('absences_company_id_idx').on(t.companyId),
  index('absences_caregiver_id_idx').on(t.caregiverId),
  index('absences_date_idx').on(t.date),
])

export const timeEntries = pgTable('time_entries', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  caregiverId: text('caregiver_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  clientId: text('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
  assignmentId: text('assignment_id'),
  scheduleId: text('schedule_id').references(() => schedules.id),
  startTime: timestamp('start_time').notNull(),
  endTime: timestamp('end_time'),
  durationMinutes: integer('duration_minutes'),
  allottedMinutes: integer('allotted_minutes'),
  billableMinutes: integer('billable_minutes'),
  discrepancyMinutes: integer('discrepancy_minutes'),
  clockInLocation: json('clock_in_location'),
  clockOutLocation: json('clock_out_location'),
  isComplete: boolean('is_complete').default(false).notNull(),
  notes: text('notes'),
  // EVV (0014_evv): IVR caller number (Sandata Telephony calls) and the Sandata decision made
  // at clock-in (true = sent to Sandata, false = not, null = no decision).
  originPhone: text('origin_phone'),
  sandataRequired: boolean('sandata_required'),
  // Approval queue (0016_visits): unscheduled visits, clock variance over the 7-minute grace,
  // zero-duration taps, implausibly long shifts, offline punches and forced clock-outs.
  needsApproval: boolean('needs_approval').default(false).notNull(),
  approvalReason: text('approval_reason'),
  approvedById: text('approved_by_id').references(() => user.id),
  approvedAt: timestamp('approved_at'),
  approvedBillableMinutes: integer('approved_billable_minutes'),
  approvalNotes: text('approval_notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('time_entries_company_id_idx').on(t.companyId),
  index('time_entries_caregiver_id_idx').on(t.caregiverId),
  index('time_entries_client_id_idx').on(t.clientId),
  index('time_entries_start_time_idx').on(t.startTime),
  index('time_entries_schedule_id_idx').on(t.scheduleId),
  index('time_entries_caregiver_complete_idx').on(t.caregiverId, t.isComplete),
  index('time_entries_period_idx').on(t.startTime, t.endTime),
  index('time_entries_client_start_idx').on(t.clientId, t.startTime),
  // One open visit per caregiver: two taps of clock-in cannot make twin visits that bill twice (template
  // 0016_visits.sql; the clock-in's unique-violation catch relies on it).
  uniqueIndex('uniq_open_time_entry_per_caregiver').on(t.caregiverId).where(timeEntryOpen),
  index('idx_time_entries_needs_approval').on(t.needsApproval).where(timeEntryNeedsApproval),
])

export const gpsTracking = pgTable('gps_tracking', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  caregiverId: text('caregiver_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  timeEntryId: text('time_entry_id').references(() => timeEntries.id),
  latitude: decimal('latitude', { precision: 10, scale: 8 }).notNull(),
  longitude: decimal('longitude', { precision: 11, scale: 8 }).notNull(),
  accuracy: integer('accuracy'),
  speed: decimal('speed', { precision: 6, scale: 2 }),
  heading: integer('heading'),
  timestamp: timestamp('timestamp').defaultNow().notNull(),
}, (t) => [
  index('gps_tracking_company_id_idx').on(t.companyId),
  index('gps_tracking_caregiver_id_idx').on(t.caregiverId),
  index('gps_tracking_time_entry_id_idx').on(t.timeEntryId),
  index('gps_tracking_timestamp_idx').on(t.timestamp),
  index('gps_tracking_entry_timestamp_idx').on(t.timeEntryId, t.timestamp),
])

export const geofenceSettings = pgTable('geofence_settings', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  clientId: text('client_id').notNull().unique().references(() => clients.id, { onDelete: 'cascade' }),
  radiusFeet: integer('radius_feet').default(300).notNull(),
  autoClockIn: boolean('auto_clock_in').default(true).notNull(),
  autoClockOut: boolean('auto_clock_out').default(true).notNull(),
  requireGps: boolean('require_gps').default(true).notNull(),
  notifyAdminOnOverride: boolean('notify_admin_on_override').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('geofence_settings_company_id_idx').on(t.companyId),
])

export const serviceCodes = pgTable('service_codes', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  code: text('code').notNull(),
  modifier1: text('modifier1'),
  modifier2: text('modifier2'),
  description: text('description').notNull(),
  serviceCategory: text('service_category'),
  payerType: text('payer_type').default('all').notNull(),
  unitType: text('unit_type').default('15min').notNull(),
  ratePerUnit: decimal('rate_per_unit', { precision: 8, scale: 4 }),
  requiresEvv: boolean('requires_evv').default(true).notNull(),
  // The Payers & Codes form's revenue code, prior-authorization flag and notes (migration 0011): the template's form
  // showed and sent them and no column kept them.
  revenueCode: text('revenue_code'),
  requiresAuth: boolean('requires_auth').default(false).notNull(),
  notes: text('notes'),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('service_codes_company_id_idx').on(t.companyId),
  index('service_codes_code_idx').on(t.code),
  index('service_codes_is_active_idx').on(t.isActive),
])

export const authorizations = pgTable('authorizations', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  clientId: text('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
  payerId: text('payer_id').references(() => referralSources.id),
  authNumber: text('auth_number'),
  midasAuthId: text('midas_auth_id'),
  procedureCode: text('procedure_code'),
  modifier: text('modifier'),
  authorizedUnits: decimal('authorized_units', { precision: 10, scale: 2 }).notNull(),
  unitType: text('unit_type').default('15min').notNull(),
  usedUnits: decimal('used_units', { precision: 10, scale: 2 }).default('0').notNull(),
  startDate: date('start_date').notNull(),
  endDate: date('end_date').notNull(),
  status: text('status').default('active').notNull(),
  lowUnitsAlertThreshold: decimal('low_units_alert_threshold', { precision: 10, scale: 2 }).default('20').notNull(),
  notes: text('notes'),
  importedFrom: text('imported_from').default('manual').notNull(),
  renewalRequested: boolean('renewal_requested').default(false).notNull(),
  renewalRequestedAt: timestamp('renewal_requested_at'),
  renewalRequestedBy: text('renewal_requested_by').references(() => user.id),
  // 0005 (CVHC v12): the payer column's predecessor; declared so `drizzle-kit push` never drops it.
  referralSourceId: text('referral_source_id'),
  createdById: text('created_by_id').references(() => user.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('authorizations_company_id_idx').on(t.companyId),
  index('authorizations_client_id_idx').on(t.clientId),
  index('authorizations_dates_idx').on(t.startDate, t.endDate),
  index('authorizations_status_idx').on(t.status),
])

export const evvVisits = pgTable('evv_visits', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  timeEntryId: text('time_entry_id').notNull().unique().references(() => timeEntries.id, { onDelete: 'cascade' }),
  clientId: text('client_id').notNull().references(() => clients.id),
  caregiverId: text('caregiver_id').notNull(),
  authorizationId: text('authorization_id').references(() => authorizations.id),
  serviceCode: text('service_code'),
  modifier: text('modifier'),
  serviceDate: date('service_date').notNull(),
  actualStart: timestamp('actual_start').notNull(),
  actualEnd: timestamp('actual_end'),
  unitsOfService: decimal('units_of_service', { precision: 8, scale: 2 }),
  gpsInLat: decimal('gps_in_lat', { precision: 10, scale: 7 }),
  gpsInLng: decimal('gps_in_lng', { precision: 10, scale: 7 }),
  gpsOutLat: decimal('gps_out_lat', { precision: 10, scale: 7 }),
  gpsOutLng: decimal('gps_out_lng', { precision: 10, scale: 7 }),
  sandataStatus: text('sandata_status').default('pending').notNull(),
  sandataVisitId: text('sandata_visit_id'),
  sandataSubmittedAt: timestamp('sandata_submitted_at'),
  sandataResponse: json('sandata_response'),
  sandataExceptionCode: text('sandata_exception_code'),
  sandataExceptionDesc: text('sandata_exception_desc'),
  evvMethod: text('evv_method').default('gps').notNull(),
  isVerified: boolean('is_verified').default(false).notNull(),
  verificationIssues: json('verification_issues').default([]).notNull(),
  // Sandata submission state (0014_evv)
  sandataSequence: bigint('sandata_sequence', { mode: 'number' }).default(0),
  sandataUuid: text('sandata_uuid'),
  needsResubmit: boolean('needs_resubmit').default(false),
  autoSubmitEnabled: boolean('auto_submit_enabled').default(true),
  exceptionAck: boolean('exception_ack').default(false),
  exceptionAckById: text('exception_ack_by_id').references(() => user.id),
  exceptionAckAt: timestamp('exception_ack_at'),
  exceptionAckReason: text('exception_ack_reason'),
  exceptionAckMemo: text('exception_ack_memo'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('evv_visits_company_id_idx').on(t.companyId),
  index('evv_visits_client_date_idx').on(t.clientId, t.serviceDate),
  index('evv_visits_caregiver_id_idx').on(t.caregiverId),
  index('evv_visits_sandata_status_idx').on(t.sandataStatus),
])

// Structured visit time-change log. A row means an office user set that punch time, so the visit
// goes to Sandata as Adjusted time + a VisitChanges record. Reason codes 1,2,3,4,5,7,8
// (5 and 8 require a memo); resolution 1 = written documentation maintained.
export const visitTimeChanges = pgTable('visit_time_changes', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  timeEntryId: text('time_entry_id').notNull().references(() => timeEntries.id, { onDelete: 'cascade' }),
  changedById: text('changed_by_id').references(() => user.id),
  changedAt: timestamp('changed_at').defaultNow().notNull(),
  oldStart: timestamp('old_start'),
  newStart: timestamp('new_start'),
  oldEnd: timestamp('old_end'),
  newEnd: timestamp('new_end'),
  reasonCode: text('reason_code').notNull(),
  memo: text('memo'),
  resolutionCode: text('resolution_code').default('1'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('visit_time_changes_company_id_idx').on(t.companyId),
  index('visit_time_changes_entry_idx').on(t.timeEntryId),
])

// Serialized Sandata submission queue: queued → processing → completed | failed (→ needs_manual).
export const sandataSubmissionQueue = pgTable('sandata_submission_queue', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  evvVisitId: text('evv_visit_id').notNull().references(() => evvVisits.id, { onDelete: 'cascade' }),
  submissionPath: text('submission_path').default('api').notNull(),
  status: text('status').default('queued').notNull(),
  retryCount: integer('retry_count').default(0),
  lastError: text('last_error'),
  nextRetryAt: timestamp('next_retry_at'),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('sandata_submission_queue_company_id_idx').on(t.companyId),
  index('sandata_queue_status_idx').on(t.status, t.createdAt),
  index('sandata_queue_evv_idx').on(t.evvVisitId),
])

export const validationLog = pgTable('validation_log', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  validationType: text('validation_type').notNull(),
  status: text('status').notNull(),
  message: text('message'),
  details: json('details'),
  resolvedAt: timestamp('resolved_at'),
  resolvedById: text('resolved_by_id').references(() => user.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('validation_log_company_id_idx').on(t.companyId),
  index('validation_log_entity_idx').on(t.entityId, t.entityType),
])

/** The friendly invoice number's sequence (template 0015_billing.sql). */
export const invoiceSeqNumberSeq = pgSequence('invoice_seq_number_seq', { startWith: 1 })

export const invoices = pgTable('invoices', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  invoiceNumber: text('invoice_number').notNull().unique(),
  clientId: text('client_id').notNull().references(() => clients.id),
  billingPeriodStart: date('billing_period_start').notNull(),
  billingPeriodEnd: date('billing_period_end').notNull(),
  subtotal: decimal('subtotal', { precision: 12, scale: 2 }).notNull(),
  tax: decimal('tax', { precision: 12, scale: 2 }).default('0').notNull(),
  total: decimal('total', { precision: 12, scale: 2 }).notNull(),
  paymentStatus: text('payment_status').default('pending').notNull(),
  paymentDueDate: date('payment_due_date'),
  paymentDate: date('payment_date'),
  paymentMethod: text('payment_method'),
  stripePaymentIntentId: text('stripe_payment_intent_id'),
  referralSourceId: text('referral_source_id').references(() => referralSources.id),
  invoiceType: text('invoice_type'),
  paidAt: timestamp('paid_at'),
  amountPaid: decimal('amount_paid', { precision: 12, scale: 2 }),
  amountAdjusted: decimal('amount_adjusted', { precision: 12, scale: 2 }),
  notes: text('notes'),
  // Billing port (0015): the friendly "Invoice #42", from its own sequence (invoiceSeqNumberSeq below; the first
  // home-care migration left it out, so every invoice had none — restored by 0010). Never set it from code, and never
  // derive it from a count (a delete would hand the same number out twice).
  seqNumber: integer('seq_number').default(invoiceSeqNext),
  // NULL = draft: the family portal and the public pay page do not show it until it is sent,
  // released, or has a payment recorded (CVHC v55).
  sentAt: timestamp('sent_at'),
  // The invoice's own private link (/d/<token>), minted when it is first emailed — the same rule as the CRM's invoices
  // (packages/tenant-backend portal/documentLinks.ts). The email linked /pay/<invoice id>, and only when FRONTEND_URL
  // was set (live test, 2026-10-23: the agency's invoice email had no way to pay).
  publicToken: text('public_token').unique(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('invoices_company_id_idx').on(t.companyId),
  uniqueIndex('invoices_seq_number_unique').on(t.seqNumber),
  index('invoices_client_id_idx').on(t.clientId),
  index('invoices_payment_status_idx').on(t.paymentStatus),
  index('invoices_period_status_idx').on(t.billingPeriodStart, t.billingPeriodEnd, t.paymentStatus),
])

export const invoiceLineItems = pgTable('invoice_line_items', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  invoiceId: text('invoice_id').notNull().references(() => invoices.id, { onDelete: 'cascade' }),
  timeEntryId: text('time_entry_id').references(() => timeEntries.id),
  caregiverId: text('caregiver_id').notNull(),
  description: text('description').notNull(),
  serviceDate: date('service_date'),
  hours: decimal('hours', { precision: 6, scale: 2 }).notNull(),
  rate: decimal('rate', { precision: 10, scale: 2 }).notNull(),
  // 0025: the unit `rate` is in — 'hourly' (hours × rate) or '15min' (hours × 4 units × rate), the
  // rate_type of the rate that priced the line. The invoice prints quantity and rate in this unit.
  rateType: text('rate_type'),
  amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
  // Billing port (0015, CVHC v58): why this line is the number it is.
  billedBasis: text('billed_basis'), // 'scheduled' | 'clocked' | 'unscheduled'
  scheduledMinutes: integer('scheduled_minutes'),
  clockedMinutes: integer('clocked_minutes'),
  // The visit this line bills: service_date + start_time (the SCHEDULED start) + caregiver_id is
  // the same identity a visit's care note carries, so the note can print on the invoice.
  startTime: time('start_time'),
  endTime: time('end_time'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('invoice_line_items_company_id_idx').on(t.companyId),
  index('invoice_line_items_invoice_id_idx').on(t.invoiceId),
])

export const ediBatches = pgTable('edi_batches', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  payerId: text('payer_id').references(() => referralSources.id),
  batchNumber: text('batch_number').notNull().unique(),
  status: text('status').default('draft').notNull(),
  claimCount: integer('claim_count').default(0).notNull(),
  totalBilled: decimal('total_billed', { precision: 10, scale: 2 }).default('0').notNull(),
  ediContent: text('edi_content'),
  filePath: text('file_path'),
  submittedAt: timestamp('submitted_at'),
  responseCode: text('response_code'),
  responseMessage: text('response_message'),
  createdById: text('created_by_id').references(() => user.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('edi_batches_company_id_idx').on(t.companyId),
  index('edi_batches_status_idx').on(t.status),
])

export const claims = pgTable('claims', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  clientId: text('client_id'),
  caregiverId: text('caregiver_id'),
  ediBatchId: text('edi_batch_id').references(() => ediBatches.id),
  evvVisitId: text('evv_visit_id').references(() => evvVisits.id),
  authorizationId: text('authorization_id').references(() => authorizations.id),
  payerId: text('payer_id'),
  claimNumber: text('claim_number'),
  serviceDate: date('service_date'),
  serviceCode: text('service_code'),
  billedAmount: decimal('billed_amount', { precision: 10, scale: 2 }),
  allowedAmount: decimal('allowed_amount', { precision: 10, scale: 2 }),
  paidAmount: decimal('paid_amount', { precision: 10, scale: 2 }),
  denialCode: text('denial_code'),
  denialReason: text('denial_reason'),
  status: text('status').default('pending').notNull(),
  submissionDate: date('submission_date'),
  acceptedDate: date('accepted_date'),
  paidDate: date('paid_date'),
  submissionMethod: text('submission_method'),
  ediFilePath: text('edi_file_path'),
  clearinghouseId: text('clearinghouse_id'),
  eobNotes: text('eob_notes'),
  checkNumber: text('check_number'),
  unitsBilled: decimal('units_billed', { precision: 10, scale: 2 }),
  payerType: text('payer_type'),
  resubmittedFrom: text('resubmitted_from'),
  voidedAt: timestamp('voided_at'),
  voidedBy: text('voided_by'),
  notes: text('notes'),
  // Billing port (0015, CVHC v16). CVHC's charge_amount / submitted_date / procedure_code / units
  // are this table's billed_amount / submission_date / service_code / units_billed.
  invoiceId: text('invoice_id'),
  modifier: text('modifier'),
  diagnosisCode: text('diagnosis_code'),
  serviceDateFrom: date('service_date_from'),
  serviceDateTo: date('service_date_to'),
  placeOfService: text('place_of_service'),
  createdById: text('created_by_id'),
  unitsDeductedAt: timestamp('units_deducted_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('claims_company_id_idx').on(t.companyId),
  index('claims_invoice_id_idx').on(t.invoiceId),
  index('claims_edi_batch_id_idx').on(t.ediBatchId),
  index('claims_evv_visit_id_idx').on(t.evvVisitId),
  index('claims_status_idx').on(t.status),
  index('idx_claims_payer_status').on(t.payerId, t.status),
  index('idx_claims_caregiver').on(t.caregiverId),
  index('idx_claims_service_date').on(t.serviceDate),
  index('idx_claims_denial').on(t.status, t.denialCode),
])

export const payments = pgTable('payments', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  payerId: text('payer_id').references(() => referralSources.id),
  payerName: text('payer_name'),
  checkNumber: text('check_number'),
  checkDate: date('check_date'),
  checkAmount: decimal('check_amount', { precision: 12, scale: 2 }).notNull(),
  paymentDate: date('payment_date'),
  paymentMethod: text('payment_method').default('check'),
  scanImagePath: text('scan_image_path'),
  aiExtractedData: json('ai_extracted_data'),
  reconciliationStatus: text('reconciliation_status').default('unreconciled'),
  reconciliationNotes: text('reconciliation_notes'),
  totalMatched: decimal('total_matched', { precision: 12, scale: 2 }).default('0'),
  underpaymentAmount: decimal('underpayment_amount', { precision: 12, scale: 2 }).default('0'),
  overpaymentAmount: decimal('overpayment_amount', { precision: 12, scale: 2 }).default('0'),
  createdBy: text('created_by').references(() => user.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('payments_company_id_idx').on(t.companyId),
  index('payments_payer_idx').on(t.payerId),
  index('payments_status_idx').on(t.reconciliationStatus),
  index('payments_date_idx').on(t.paymentDate),
])

export const paymentClaimMatches = pgTable('payment_claim_matches', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  paymentId: text('payment_id').notNull().references(() => payments.id, { onDelete: 'cascade' }),
  claimId: text('claim_id').notNull().references(() => claims.id),
  matchedAmount: decimal('matched_amount', { precision: 12, scale: 2 }).notNull(),
  matchType: text('match_type').default('auto'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('payment_claim_matches_company_id_idx').on(t.companyId),
  index('pcm_payment_idx').on(t.paymentId),
  index('pcm_claim_idx').on(t.claimId),
])

// Per-invoice payment records (distinct from the `payments` table which
// captures payer-level check receipts and reconciles to claims).
export const invoicePayments = pgTable('invoice_payments', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  invoiceId: text('invoice_id').notNull().references(() => invoices.id, { onDelete: 'cascade' }),
  amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
  paymentMethod: text('payment_method').default('check').notNull(),
  referenceNumber: text('reference_number'),
  paymentDate: date('payment_date'),
  notes: text('notes'),
  createdById: text('created_by_id').references(() => user.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('invoice_payments_company_id_idx').on(t.companyId),
  index('invoice_payments_invoice_id_idx').on(t.invoiceId),
  index('invoice_payments_payment_date_idx').on(t.paymentDate),
])

export const remittanceBatches = pgTable('remittance_batches', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  payerId: text('payer_id').references(() => referralSources.id),
  payerName: text('payer_name').notNull(),
  payerType: text('payer_type').default('other').notNull(),
  checkNumber: text('check_number'),
  checkDate: date('check_date'),
  paymentDate: date('payment_date'),
  totalAmount: decimal('total_amount', { precision: 10, scale: 2 }).notNull(),
  rawOcrText: text('raw_ocr_text'),
  status: text('status').default('pending_match').notNull(),
  notes: text('notes'),
  createdById: text('created_by_id').references(() => user.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('remittance_batches_company_id_idx').on(t.companyId),
  index('remittance_batches_payer_id_idx').on(t.payerId),
])

export const remittanceLineItems = pgTable('remittance_line_items', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  batchId: text('batch_id').notNull().references(() => remittanceBatches.id, { onDelete: 'cascade' }),
  clientId: text('client_id'),
  invoiceId: text('invoice_id').references(() => invoices.id),
  claimId: text('claim_id').references(() => claims.id),
  claimNumber: text('claim_number'),
  serviceDateFrom: date('service_date_from'),
  serviceDateTo: date('service_date_to'),
  billedAmount: decimal('billed_amount', { precision: 10, scale: 2 }),
  allowedAmount: decimal('allowed_amount', { precision: 10, scale: 2 }),
  paidAmount: decimal('paid_amount', { precision: 10, scale: 2 }).notNull(),
  adjustmentAmount: decimal('adjustment_amount', { precision: 10, scale: 2 }).default('0').notNull(),
  denialCode: text('denial_code'),
  denialReason: text('denial_reason'),
  matchStatus: text('match_status').default('unmatched').notNull(),
  matchedAt: timestamp('matched_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('remittance_line_items_company_id_idx').on(t.companyId),
  index('remittance_line_items_batch_id_idx').on(t.batchId),
])

export const gustoSyncLog = pgTable('gusto_sync_log', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  syncType: text('sync_type').notNull(),
  status: text('status').notNull(),
  payPeriodStart: date('pay_period_start'),
  payPeriodEnd: date('pay_period_end'),
  recordsExported: integer('records_exported').default(0).notNull(),
  gustoResponse: json('gusto_response'),
  errorMessage: text('error_message'),
  createdById: text('created_by_id').references(() => user.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('gusto_sync_log_company_id_idx').on(t.companyId),
])

export const gustoEmployeeMap = pgTable('gusto_employee_map', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().unique().references(() => user.id, { onDelete: 'cascade' }),
  gustoEmployeeId: text('gusto_employee_id'),
  gustoUuid: text('gusto_uuid'),
  isSynced: boolean('is_synced').default(false).notNull(),
  lastSyncedAt: timestamp('last_synced_at'),
  // Who marked the caregiver as copied into Gusto (onboarding packet → "Mark Synced").
  syncedById: text('synced_by_id').references(() => user.id),
}, (t) => [
  index('gusto_employee_map_company_id_idx').on(t.companyId),
])

export const expenses = pgTable('expenses', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  category: text('category'),
  description: text('description').notNull(),
  amount: decimal('amount', { precision: 10, scale: 2 }).notNull(),
  date: date('date').notNull(),
  receiptUrl: text('receipt_url'),
  status: text('status').default('pending').notNull(),
  notes: text('notes'),
  // The expense form's vendor, payment method and the two flags (migration 0011): the template's form showed and sent
  // them and no column kept them.
  vendor: text('vendor'),
  paymentMethod: text('payment_method'),
  taxDeductible: boolean('tax_deductible').default(false).notNull(),
  reimbursable: boolean('reimbursable').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('expenses_company_id_idx').on(t.companyId),
  index('expenses_user_id_idx').on(t.userId),
])

export const performanceRatings = pgTable('performance_ratings', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  caregiverId: text('caregiver_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  clientId: text('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
  ratingDate: date('rating_date').defaultNow().notNull(),
  satisfactionScore: integer('satisfaction_score'),
  punctualityScore: integer('punctuality_score'),
  professionalismScore: integer('professionalism_score'),
  careQualityScore: integer('care_quality_score'),
  comments: text('comments'),
  noShows: integer('no_shows').default(0).notNull(),
  lateArrivals: integer('late_arrivals').default(0).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('performance_ratings_company_id_idx').on(t.companyId),
  index('performance_ratings_caregiver_id_idx').on(t.caregiverId),
  index('performance_ratings_client_id_idx').on(t.clientId),
])

export const backgroundChecks = pgTable('background_checks', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  caregiverId: text('caregiver_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  checkType: text('check_type').default('criminal').notNull(),
  provider: text('provider'),
  cost: decimal('cost', { precision: 8, scale: 2 }),
  status: text('status').default('pending').notNull(),
  initiatedDate: date('initiated_date').defaultNow().notNull(),
  expirationDate: date('expiration_date'),
  worcsReferenceNumber: text('worcs_reference_number'),
  worcsStatus: text('worcs_status'),
  ssnEncrypted: text('ssn_encrypted'),
  driversLicenseEncrypted: text('drivers_license_encrypted'),
  driversLicenseState: text('drivers_license_state'),
  referenceNumber: text('reference_number'),
  findings: text('findings'),
  // clear | flagged | disqualifying (entered by the office) · clear | record_found | error (WORCS poll)
  result: text('result'),
  completedDate: date('completed_date'),
  notes: text('notes'),
  // 0005 (CVHC v12); declared so the boot's `drizzle-kit push` never drops them.
  createdBy: text('created_by'),
  submittedDate: date('submitted_date'),
  createdById: text('created_by_id').references(() => user.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('background_checks_company_id_idx').on(t.companyId),
  index('background_checks_caregiver_id_idx').on(t.caregiverId),
  index('background_checks_expiration_date_idx').on(t.expirationDate),
])

export const notifications = pgTable('notifications', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  type: text('type'),
  title: text('title').notNull(),
  message: text('message'),
  isRead: boolean('is_read').default(false).notNull(),
  emailSent: boolean('email_sent').default(false).notNull(),
  pushSent: boolean('push_sent').default(false).notNull(),
  // new → handled → archived. Moves together with isRead; the bell counts 'new'.
  status: text('status').default('new').notNull(),
  handledAt: timestamp('handled_at'),
  handledById: text('handled_by_id').references(() => user.id, { onDelete: 'set null' }),
  // 0005 (CVHC v14) addressing columns; declared so the boot's `drizzle-kit push` never drops them.
  recipientType: text('recipient_type'),
  recipientId: text('recipient_id'),
  notificationType: text('notification_type'),
  subject: text('subject'),
  sentBy: text('sent_by'),
  updatedAt: timestamp('updated_at').defaultNow(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('notifications_company_id_idx').on(t.companyId),
  index('notifications_user_id_idx').on(t.userId),
  index('notifications_is_read_idx').on(t.isRead),
  index('notifications_user_status_idx').on(t.userId, t.status),
])

export const notificationPreferences = pgTable('notification_preferences', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().unique().references(() => user.id, { onDelete: 'cascade' }),
  emailEnabled: boolean('email_enabled').default(true).notNull(),
  pushEnabled: boolean('push_enabled').default(true).notNull(),
  scheduleAlerts: boolean('schedule_alerts').default(true).notNull(),
  absenceAlerts: boolean('absence_alerts').default(true).notNull(),
  billingAlerts: boolean('billing_alerts').default(true).notNull(),
  ratingAlerts: boolean('rating_alerts').default(true).notNull(),
  dailyDigest: boolean('daily_digest').default(true).notNull(),
  smsEnabled: boolean('sms_enabled').default(true).notNull(),
  shiftReminderAlerts: boolean('shift_reminder_alerts').default(true).notNull(),
  payrollAlerts: boolean('payroll_alerts').default(true).notNull(),
  paymentAlerts: boolean('payment_alerts').default(true).notNull(),
  lowAuthAlerts: boolean('low_auth_alerts').default(true).notNull(),
  expiringCertAlerts: boolean('expiring_cert_alerts').default(true).notNull(),
  messageAlerts: boolean('message_alerts').default(true).notNull(),
  // Quiet hours, e.g. 21:00 → 07:00 (an overnight window wraps midnight).
  quietHoursStart: time('quiet_hours_start'),
  quietHoursEnd: time('quiet_hours_end'),
  quietHoursSkipEmergency: boolean('quiet_hours_skip_emergency').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('notification_preferences_company_id_idx').on(t.companyId),
])

export const pushSubscriptions = pgTable('push_subscriptions', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  subscription: json('subscription').notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('push_subscriptions_company_id_idx').on(t.companyId),
  index('push_subscriptions_is_active_idx').on(t.isActive),
])

export const messageThreads = pgTable('message_threads', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  subject: text('subject').notNull(),
  createdById: text('created_by_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  threadType: text('thread_type').default('direct').notNull(),
  isBroadcast: boolean('is_broadcast').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('message_threads_company_id_idx').on(t.companyId),
  index('message_threads_updated_at_idx').on(t.updatedAt),
])

export const messageThreadParticipants = pgTable('message_thread_participants', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  threadId: text('thread_id').notNull().references(() => messageThreads.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  lastReadAt: timestamp('last_read_at'),
  joinedAt: timestamp('joined_at').defaultNow().notNull(),
}, (t) => [
  index('message_thread_participants_company_id_idx').on(t.companyId),
  uniqueIndex('message_thread_participants_thread_user_idx').on(t.threadId, t.userId),
  index('message_thread_participants_user_id_idx').on(t.userId),
  index('message_thread_participants_thread_id_idx').on(t.threadId),
])

export const messages = pgTable('messages', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  threadId: text('thread_id').notNull().references(() => messageThreads.id, { onDelete: 'cascade' }),
  senderId: text('sender_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  body: text('body').notNull(),
  isDeleted: boolean('is_deleted').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('messages_company_id_idx').on(t.companyId),
  index('messages_thread_created_idx').on(t.threadId, t.createdAt),
])

export const communicationLog = pgTable('communication_log', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  logType: text('log_type').default('note').notNull(),
  direction: text('direction'),
  subject: text('subject'),
  body: text('body').notNull(),
  loggedById: text('logged_by_id').references(() => user.id),
  loggedByName: text('logged_by_name'),
  clientId: text('client_id').references(() => clients.id),
  followUpDate: date('follow_up_date'),
  followUpDone: boolean('follow_up_done').default(false).notNull(),
  isPinned: boolean('is_pinned').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('communication_log_company_id_idx').on(t.companyId),
  index('communication_log_entity_idx').on(t.entityType, t.entityId),
  index('communication_log_created_at_idx').on(t.createdAt),
])

export const noshowAlertConfig = pgTable('noshow_alert_config', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  graceMinutes: integer('grace_minutes').default(15).notNull(),
  notifyAdmin: boolean('notify_admin').default(true).notNull(),
  notifyCaregiver: boolean('notify_caregiver').default(true).notNull(),
  notifyClientFamily: boolean('notify_client_family').default(false).notNull(),
  adminPhone: text('admin_phone'),
  adminEmail: text('admin_email'),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('noshow_alert_config_company_id_idx').on(t.companyId),
])

export const noshowAlerts = pgTable('noshow_alerts', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  scheduleId: text('schedule_id').references(() => schedules.id),
  caregiverId: text('caregiver_id').references(() => user.id),
  clientId: text('client_id').references(() => clients.id),
  shiftDate: date('shift_date').notNull(),
  expectedStart: time('expected_start').notNull(),
  alertedAt: timestamp('alerted_at').defaultNow().notNull(),
  resolvedAt: timestamp('resolved_at'),
  resolvedById: text('resolved_by_id').references(() => user.id),
  resolutionNote: text('resolution_note'),
  status: text('status').default('open').notNull(),
  smsSent: boolean('sms_sent').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('noshow_alerts_company_id_idx').on(t.companyId),
  index('noshow_alerts_status_date_idx').on(t.status, t.shiftDate),
  index('noshow_alerts_caregiver_id_idx').on(t.caregiverId),
])

export const formTemplates = pgTable('form_templates', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  category: text('category').default('general').notNull(),
  fields: json('fields').default([]).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  requiresSignature: boolean('requires_signature').default(false).notNull(),
  autoAttachTo: text('auto_attach_to'),
  // Seeded library template (care, 0017). A built-in can be switched off, not deleted.
  isBuiltIn: boolean('is_built_in').default(false).notNull(),
  // A template that only applies in one state (a state Medicaid form). NULL = every agency.
  state: text('state'),
  createdById: text('created_by_id').references(() => user.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('form_templates_company_id_idx').on(t.companyId),
  index('form_templates_category_active_idx').on(t.category, t.isActive),
])

export const formSubmissions = pgTable('form_submissions', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  templateId: text('template_id').references(() => formTemplates.id),
  templateName: text('template_name'),
  entityType: text('entity_type'),
  entityId: text('entity_id'),
  clientId: text('client_id').references(() => clients.id),
  submittedById: text('submitted_by_id').references(() => user.id),
  submittedByName: text('submitted_by_name'),
  data: json('data').default({}).notNull(),
  signature: text('signature'),
  signedAt: timestamp('signed_at'),
  status: text('status').default('draft').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('form_submissions_company_id_idx').on(t.companyId),
  index('form_submissions_entity_idx').on(t.entityType, t.entityId),
  index('form_submissions_template_id_idx').on(t.templateId),
])

export const loginActivity = pgTable('login_activity', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
  success: boolean('success').default(false).notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  failReason: text('fail_reason'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('login_activity_company_id_idx').on(t.companyId),
  index('login_activity_email_idx').on(t.email),
  index('login_activity_user_id_idx').on(t.userId),
  index('login_activity_created_at_idx').on(t.createdAt),
])

export const auditLogs = pgTable('audit_logs', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull(),
  action: text('action').notNull(),
  tableName: text('table_name'),
  recordId: text('record_id'),
  oldData: json('old_data'),
  newData: json('new_data'),
  ipAddress: text('ip_address'),
  reasonCode: text('reason_code'),
  // 0005 (CVHC v12); declared so the boot's `drizzle-kit push` never drops it.
  isSensitive: boolean('is_sensitive').default(false),
  timestamp: timestamp('timestamp').defaultNow().notNull(),
}, (t) => [
  index('audit_logs_company_id_idx').on(t.companyId),
  index('audit_logs_user_id_idx').on(t.userId),
  index('audit_logs_timestamp_idx').on(t.timestamp),
  index('audit_logs_table_name_idx').on(t.tableName),
])

export const serviceLocations = pgTable('service_locations', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  address: text('address'),
  city: text('city'),
  state: text('state'),
  zip: text('zip'),
  latitude: decimal('latitude', { precision: 10, scale: 8 }),
  longitude: decimal('longitude', { precision: 11, scale: 8 }),
  serviceRadiusMiles: integer('service_radius_miles').default(5).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('service_locations_company_id_idx').on(t.companyId),
])

export const helpArticles = pgTable('help_articles', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull(),
  title: text('title').notNull(),
  content: text('content').notNull(),
  category: text('category'),
  tags: json('tags').default([]).notNull(),
  isFaq: boolean('is_faq').default(false).notNull(),
  published: boolean('published').default(true).notNull(),
  sortOrder: integer('sort_order').default(0).notNull(),
  viewCount: integer('view_count').default(0).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('help_articles_company_id_idx').on(t.companyId),
  index('help_articles_category_idx').on(t.category),
])

export const clientNotifications = pgTable('client_notifications', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  clientId: text('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
  type: text('type'),
  title: text('title').notNull(),
  message: text('message'),
  isRead: boolean('is_read').default(false).notNull(),
  relatedVisitId: text('related_visit_id'),
  relatedInvoiceId: text('related_invoice_id'),
  relatedCaregiverId: text('related_caregiver_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('client_notifications_company_id_idx').on(t.companyId),
  index('client_notifications_client_id_idx').on(t.clientId),
  index('client_notifications_is_read_idx').on(t.isRead),
])

export const portalMessageThreads = pgTable('portal_message_threads', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  clientId: text('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
  subject: text('subject').notNull(),
  status: text('status').default('open').notNull(),
  lastMessageAt: timestamp('last_message_at').defaultNow().notNull(),
  clientLastReadAt: timestamp('client_last_read_at'),
  staffLastReadAt: timestamp('staff_last_read_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('portal_message_threads_company_id_idx').on(t.companyId),
  index('portal_message_threads_client_id_idx').on(t.clientId),
  index('portal_message_threads_last_message_idx').on(t.lastMessageAt),
])

export const portalMessages = pgTable('portal_messages', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  threadId: text('thread_id').notNull().references(() => portalMessageThreads.id, { onDelete: 'cascade' }),
  senderType: text('sender_type').notNull(), // 'client' or 'staff'
  senderName: text('sender_name'),
  body: text('body').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('portal_messages_company_id_idx').on(t.companyId),
  index('portal_messages_thread_created_idx').on(t.threadId, t.createdAt),
])

export const dashboardCache = pgTable('dashboard_cache', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  cacheKey: text('cache_key').notNull().unique(),
  data: json('data'),
  expiresAt: timestamp('expires_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('dashboard_cache_company_id_idx').on(t.companyId),
])

export const adlRequirements = pgTable('adl_requirements', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  clientId: text('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
  adlCategory: text('adl_category').notNull(),
  assistanceLevel: text('assistance_level').notNull(),
  frequency: text('frequency'),
  specialInstructions: text('special_instructions'),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('adl_requirements_company_id_idx').on(t.companyId),
  index('adl_requirements_client_id_idx').on(t.clientId),
])

export const adlLogs = pgTable('adl_logs', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  clientId: text('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
  caregiverId: text('caregiver_id').references(() => user.id),
  adlCategory: text('adl_category').notNull(),
  status: text('status').notNull(),
  assistanceLevel: text('assistance_level'),
  performedAt: timestamp('performed_at').defaultNow().notNull(),
  notes: text('notes'),
  // The visit it was recorded on (care, 0017).
  timeEntryId: text('time_entry_id').references(() => timeEntries.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('adl_logs_company_id_idx').on(t.companyId),
  index('adl_logs_client_id_idx').on(t.clientId),
  index('adl_logs_performed_at_idx').on(t.performedAt),
  index('adl_logs_time_entry_idx').on(t.timeEntryId),
])

export const applications = pgTable('applications', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  firstName: text('first_name').notNull(),
  lastName: text('last_name').notNull(),
  email: text('email'),
  phone: text('phone'),
  address: text('address'),
  city: text('city'),
  state: text('state'),
  zip: text('zip'),
  status: text('status').default('new').notNull(),
  desiredPosition: text('desired_position'),
  desiredPayRate: decimal('desired_pay_rate', { precision: 8, scale: 2 }),
  availableStartDate: date('available_start_date'),
  experience: text('experience'),
  hasCna: boolean('has_cna').default(false).notNull(),
  hasLpn: boolean('has_lpn').default(false).notNull(),
  hasRn: boolean('has_rn').default(false).notNull(),
  hasCpr: boolean('has_cpr').default(false).notNull(),
  hasFirstAid: boolean('has_first_aid').default(false).notNull(),
  references: json('references').default([]).notNull(),
  notes: text('notes'),
  interviewNotes: text('interview_notes'),
  hiredUserId: text('hired_user_id').references(() => user.id),
  // ── Application form (public careers form) ──
  // The start date lives in available_start_date, the applicant's own notes in notes and the
  // references in `references` ([{ name, relationship, phone, email }]).
  dateOfBirth: date('date_of_birth'),
  hasDriversLicense: boolean('has_drivers_license').default(false).notNull(),
  hasTransportation: boolean('has_transportation').default(false).notNull(),
  legalToWork: boolean('legal_to_work').default(false).notNull(),
  willingBackgroundCheck: boolean('willing_background_check').default(false).notNull(),
  felonyConviction: boolean('felony_conviction').default(false).notNull(),
  felonyExplanation: text('felony_explanation'),
  yearsExperience: integer('years_experience').default(0).notNull(),
  cnaLicense: text('cna_license'),
  certifications: json('certifications').default([]).notNull(),
  previousEmployer: text('previous_employer'),
  reasonForLeaving: text('reason_for_leaving'),
  availabilityDays: text('availability_days'),
  availabilityShifts: text('availability_shifts'),
  hoursDesired: text('hours_desired'),
  whyInterested: text('why_interested'),
  postingId: text('posting_id').references(() => jobPostings.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('applications_company_id_idx').on(t.companyId),
  index('applications_status_idx').on(t.status),
  index('applications_created_at_idx').on(t.createdAt),
  index('applications_email_idx').on(t.email),
  index('applications_posting_id_idx').on(t.postingId),
])

export const alerts = pgTable('alerts', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  alertType: text('alert_type').notNull(),
  priority: text('priority').default('medium').notNull(),
  message: text('message').notNull(),
  status: text('status').default('active').notNull(),
  dueDate: timestamp('due_date'),
  relatedEntityType: text('related_entity_type'),
  relatedEntityId: text('related_entity_id'),
  acknowledgedAt: timestamp('acknowledged_at'),
  acknowledgedById: text('acknowledged_by_id').references(() => user.id),
  resolvedAt: timestamp('resolved_at'),
  resolvedById: text('resolved_by_id').references(() => user.id),
  resolution: text('resolution'),
  createdById: text('created_by_id').references(() => user.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('alerts_company_id_idx').on(t.companyId),
  index('alerts_status_idx').on(t.status),
  index('alerts_alert_type_idx').on(t.alertType),
  index('alerts_priority_idx').on(t.priority),
])

export const carePlans = pgTable('care_plans', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  clientId: text('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
  serviceType: text('service_type'),
  frequency: text('frequency'),
  careGoals: text('care_goals'),
  specialInstructions: text('special_instructions'),
  precautions: text('precautions'),
  // care, 0017: the note sections the screen always asked for, and the client's recurring
  // visit schedule as it stood when the plan was saved ("Fill from current schedule").
  serviceDescription: text('service_description'),
  medicationNotes: text('medication_notes'),
  mobilityNotes: text('mobility_notes'),
  dietaryNotes: text('dietary_notes'),
  communicationNotes: text('communication_notes'),
  visitSchedule: text('visit_schedule'),
  visitScheduleAsOf: date('visit_schedule_as_of'),
  startDate: date('start_date'),
  endDate: date('end_date'),
  status: text('status').default('active').notNull(),
  createdById: text('created_by_id').references(() => user.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('care_plans_company_id_idx').on(t.companyId),
  index('care_plans_client_id_idx').on(t.clientId),
])

export const careTypes = pgTable('care_types', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  hourlyRate: decimal('hourly_rate', { precision: 8, scale: 2 }),
  isActive: boolean('is_active').default(true).notNull(),
  // Added by migration 0005 and never declared here, so the boot-time drizzle push could drop them.
  // EVV reads them: the procedure code a visit is sent to Sandata under.
  defaultServiceCode: text('default_service_code'),
  defaultModifier: text('default_modifier'),
  requiresEvv: boolean('requires_evv').default(true),
  // 0005 (CVHC v13); declared so the boot's `drizzle-kit push` never drops it.
  requiredCertifications: json('required_certifications').default([]),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('care_types_company_id_idx').on(t.companyId),
])

export const caregiverCareTypeRates = pgTable('caregiver_care_type_rates', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  caregiverId: text('caregiver_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  careTypeId: text('care_type_id').notNull().references(() => careTypes.id, { onDelete: 'cascade' }),
  hourlyRate: decimal('hourly_rate', { precision: 8, scale: 2 }),
  overtimeRate: decimal('overtime_rate', { precision: 8, scale: 2 }),
  holidayRate: decimal('holiday_rate', { precision: 8, scale: 2 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('caregiver_care_type_rates_company_id_idx').on(t.companyId),
  index('caregiver_care_type_rates_caregiver_idx').on(t.caregiverId),
])

export const certificationRecords = pgTable('certification_records', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  caregiverId: text('caregiver_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  certificationType: text('certification_type').notNull(),
  issuingBody: text('issuing_body'),
  issueDate: date('issue_date'),
  expiryDate: date('expiry_date'),
  documentUrl: text('document_url'),
  certificationNumber: text('certification_number'),
  status: text('status').default('active').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('certification_records_company_id_idx').on(t.companyId),
  index('certification_records_caregiver_idx').on(t.caregiverId),
])

export const incidents = pgTable('incidents', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  clientId: text('client_id').references(() => clients.id),
  caregiverId: text('caregiver_id').references(() => user.id),
  incidentType: text('incident_type').notNull(),
  // minor | moderate | severe | critical (config/incidentOptions.ts). 0019 mapped the old low/medium/high.
  severity: text('severity').default('moderate').notNull(),
  // When it happened. `date` is the incident date; `reportedDate` is when the agency was told.
  date: date('date').notNull(),
  description: text('description').notNull(),
  involvedParties: text('involved_parties'),
  actionTaken: text('action_taken'),
  witnesses: text('witnesses'),
  injuriesOrDamage: text('injuries_or_damage'),
  followUpRequired: boolean('follow_up_required').default(false).notNull(),
  // The case status: open | investigating | closed.
  investigationStatus: text('investigation_status').default('open').notNull(),
  // The date the case was closed (stored at midnight) and who closed it.
  resolvedAt: timestamp('resolved_at'),
  resolvedById: text('resolved_by_id').references(() => user.id),
  // Who entered it in the CRM (office user or the caregiver who filed it from the app).
  reportedById: text('reported_by_id').references(() => user.id),
  // ── Incident case file (migration 0019) ──
  // IR-<year>-<nnn>: assigned once on create, never recomputed or reused (incident_number_counters).
  incidentNumber: text('incident_number'),
  incidentTime: time('incident_time'),
  followUpNotes: text('follow_up_notes'),
  // Free-text reporter: a person or an organisation (e.g. the payer that raised the concern).
  reportedBy: text('reported_by'),
  reportedDate: date('reported_date'),
  reporterContactName: text('reporter_contact_name'),
  reporterPhone: text('reporter_phone'),
  reporterEmail: text('reporter_email'),
  responseDueDate: date('response_due_date'),
  responseSentDate: date('response_sent_date'),
  // substantiated | unsubstantiated | inconclusive
  disposition: text('disposition'),
  findings: text('findings'),
  // not_required | pending | reported
  mandatoryReportStatus: text('mandatory_report_status'),
  mandatoryReportDetails: text('mandatory_report_details'),
  // Printed in the payer response letter as its own numbered item.
  payerResponseNotes: text('payer_response_notes'),
  // Caregiver removed from this client pending investigation; caregiverRemoval records every
  // schedule row changed and its prior value, so "return to schedule" restores exactly.
  caregiverRemovedFrom: date('caregiver_removed_from'),
  caregiverReturnedOn: date('caregiver_returned_on'),
  caregiverRemoval: json('caregiver_removal'),
  // Signed medication handling + misappropriation training acknowledgement (one per incident).
  trainingAckSignedAt: timestamp('training_ack_signed_at'),
  trainingAckSignerName: text('training_ack_signer_name'),
  trainingAckSignature: text('training_ack_signature'),
  trainingAckSupervisor: text('training_ack_supervisor'),
  // in_person | phone | video
  trainingAckMethod: text('training_ack_method'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('incidents_company_id_idx').on(t.companyId),
  index('incidents_status_idx').on(t.investigationStatus),
  uniqueIndex('incidents_incident_number_idx').on(t.incidentNumber),
  index('incidents_response_due_idx').on(t.responseDueDate),
])

// Investigation timeline: every call, interview, document reviewed and action taken, dated.
export const incidentInvestigationNotes = pgTable('incident_investigation_notes', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  incidentId: text('incident_id').notNull().references(() => incidents.id, { onDelete: 'cascade' }),
  entryDate: date('entry_date').notNull(),
  // call | interview | document | action | schedule | note
  entryType: text('entry_type').default('note').notNull(),
  summary: text('summary').notNull(),
  createdById: text('created_by_id').references(() => user.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('incident_investigation_notes_company_id_idx').on(t.companyId),
  index('incident_investigation_notes_incident_idx').on(t.incidentId, t.entryDate),
])

// Attachments are stored in the database as data URIs: a file written to the server's disk does not
// survive a deploy.
export const incidentAttachments = pgTable('incident_attachments', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  incidentId: text('incident_id').notNull().references(() => incidents.id, { onDelete: 'cascade' }),
  // payer_notice | statement | background_check | training | signed_response | photo | other
  category: text('category').default('other').notNull(),
  fileName: text('file_name').notNull(),
  mimeType: text('mime_type').notNull(),
  fileSize: integer('file_size'),
  fileData: text('file_data').notNull(),
  description: text('description'),
  uploadedById: text('uploaded_by_id').references(() => user.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('incident_attachments_company_id_idx').on(t.companyId),
  index('incident_attachments_incident_idx').on(t.incidentId, t.createdAt),
])

// High-water mark per incident year, so a deleted incident's number is never handed out again
// (a number already sent to a payer must keep meaning one incident).
export const incidentNumberCounters = pgTable('incident_number_counters', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  year: integer('year').notNull(),
  lastNumber: integer('last_number').notNull(),
}, (t) => [
  index('incident_number_counters_company_id_idx').on(t.companyId),
  uniqueIndex('incident_number_counters_company_year_key').on(t.companyId, t.year),
])

export const medications = pgTable('medications', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  clientId: text('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  dosage: text('dosage'),
  frequency: text('frequency'),
  route: text('route'),
  indication: text('indication'),
  prescribedBy: text('prescribed_by'),
  pharmacy: text('pharmacy'),
  rxNumber: text('rx_number'),
  instructions: text('instructions'),
  sideEffects: text('side_effects'),
  isPrn: boolean('is_prn').default(false).notNull(),
  startDate: date('start_date'),
  endDate: date('end_date'),
  status: text('status').default('active').notNull(),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('medications_company_id_idx').on(t.companyId),
  index('medications_client_idx').on(t.clientId),
])

export const medicationLogs = pgTable('medication_logs', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  medicationId: text('medication_id').notNull().references(() => medications.id, { onDelete: 'cascade' }),
  clientId: text('client_id').notNull().references(() => clients.id),
  caregiverId: text('caregiver_id').references(() => user.id),
  administeredAt: timestamp('administered_at').notNull(),
  status: text('status').default('given').notNull(),
  notes: text('notes'),
  // MAR (care, 0017): the visit, when the dose was due, what was given, who witnessed it
  // (controlled substances), and the strict status given|refused|held|self_administered|missed.
  timeEntryId: text('time_entry_id').references(() => timeEntries.id, { onDelete: 'set null' }),
  scheduledTime: timestamp('scheduled_time'),
  dosageGiven: text('dosage_given'),
  witnessedBy: text('witnessed_by'),
  effectiveStatus: text('effective_status'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('medication_logs_company_id_idx').on(t.companyId),
  index('medication_logs_time_entry_idx').on(t.timeEntryId),
])

export const shiftSwaps = pgTable('shift_swaps', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  scheduleId: text('schedule_id').references(() => schedules.id),
  requesterId: text('requester_id').notNull().references(() => user.id),
  targetId: text('target_id').references(() => user.id),
  clientId: text('client_id').references(() => clients.id),
  shiftDate: date('shift_date').notNull(),
  startTime: time('start_time'),
  endTime: time('end_time'),
  reason: text('reason'),
  status: text('status').default('pending').notNull(),
  reviewedById: text('reviewed_by_id').references(() => user.id),
  reviewedAt: timestamp('reviewed_at'),
  // 0016_visits — the target caregiver's answer (accepted / rejected) and any note with it.
  respondedAt: timestamp('responded_at'),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('shift_swaps_company_id_idx').on(t.companyId),
  index('shift_swaps_status_idx').on(t.status),
])

export const trainingRecords = pgTable('training_records', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  caregiverId: text('caregiver_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  trainingName: text('training_name').notNull(),
  provider: text('provider'),
  completedDate: date('completed_date'),
  expiryDate: date('expiry_date'),
  hoursCompleted: decimal('hours_completed', { precision: 5, scale: 1 }),
  certificateUrl: text('certificate_url'),
  certificationNumber: text('certification_number'),
  status: text('status').default('completed').notNull(),
  recordedById: text('recorded_by_id').references(() => user.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('training_records_company_id_idx').on(t.companyId),
  index('training_records_caregiver_idx').on(t.caregiverId),
  index('training_records_expiry_idx').on(t.expiryDate),
])

export const mileageEntries = pgTable('mileage_entries', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  caregiverId: text('caregiver_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  date: date('date').notNull(),
  startLocation: text('start_location'),
  endLocation: text('end_location'),
  miles: decimal('miles', { precision: 7, scale: 2 }).notNull(),
  ratePerMile: decimal('rate_per_mile', { precision: 5, scale: 3 }).default('0.670'),
  amount: decimal('amount', { precision: 8, scale: 2 }),
  clientId: text('client_id').references(() => clients.id),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('mileage_entries_company_id_idx').on(t.companyId),
  index('mileage_entries_caregiver_idx').on(t.caregiverId),
])

export const prospectAppointments = pgTable('prospect_appointments', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  leadId: text('lead_id').references(() => lead.id),
  scheduledDate: date('scheduled_date').notNull(),
  scheduledTime: time('scheduled_time'),
  notes: text('notes'),
  status: text('status').default('scheduled').notNull(),
  createdById: text('created_by_id').references(() => user.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('prospect_appointments_company_id_idx').on(t.companyId),
])

export const servicePricing = pgTable('service_pricing', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  serviceType: text('service_type').notNull(),
  description: text('description'),
  clientHourlyRate: decimal('client_hourly_rate', { precision: 8, scale: 2 }),
  caregiverHourlyRate: decimal('caregiver_hourly_rate', { precision: 8, scale: 2 }),
  marginPercent: decimal('margin_percent', { precision: 5, scale: 2 }),
  isActive: boolean('is_active').default(true).notNull(),
  effectiveDate: date('effective_date'),
  endDate: date('end_date'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('service_pricing_company_id_idx').on(t.companyId),
  index('service_pricing_service_type_idx').on(t.serviceType),
  index('service_pricing_is_active_idx').on(t.isActive),
])

export const referralSourceRates = pgTable('referral_source_rates', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  referralSourceId: text('referral_source_id').notNull().references(() => referralSources.id, { onDelete: 'cascade' }),
  careTypeId: text('care_type_id').references(() => careTypes.id),
  rateAmount: decimal('rate_amount', { precision: 8, scale: 2 }).notNull(),
  rateType: text('rate_type').default('hourly').notNull(),
  effectiveDate: date('effective_date'),
  endDate: date('end_date'),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('referral_source_rates_company_id_idx').on(t.companyId),
  index('referral_source_rates_referral_source_id_idx').on(t.referralSourceId),
  index('referral_source_rates_care_type_id_idx').on(t.careTypeId),
])

export const invoiceAdjustments = pgTable('invoice_adjustments', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  invoiceId: text('invoice_id').notNull().references(() => invoices.id, { onDelete: 'cascade' }),
  adjustmentType: text('adjustment_type').notNull(),
  amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
  reason: text('reason'),
  notes: text('notes'),
  createdById: text('created_by_id').references(() => user.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('invoice_adjustments_company_id_idx').on(t.companyId),
  index('invoice_adjustments_invoice_id_idx').on(t.invoiceId),
])

export const claimStatusHistory = pgTable('claim_status_history', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  claimId: text('claim_id').notNull().references(() => claims.id, { onDelete: 'cascade' }),
  status: text('status').notNull(),
  notes: text('notes'),
  createdBy: text('created_by').references(() => user.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('claim_status_history_company_id_idx').on(t.companyId),
  index('claim_status_history_claim_id_idx').on(t.claimId),
])

export const denialCodeLookup = pgTable('denial_code_lookup', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  // Named as 0007's UNIQUE created it; drizzle's default name (_code_unique) makes push offer to truncate the table.
  code: text('code').notNull().unique('denial_code_lookup_code_key'),
  description: text('description').notNull(),
  category: text('category'),
  remediation: text('remediation'),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('denial_code_lookup_company_id_idx').on(t.companyId),
])

export const smsTemplates = pgTable('sms_templates', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  body: text('body').notNull(),
  category: text('category'),
  variables: json('variables').default([]).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('sms_templates_company_id_idx').on(t.companyId),
])

export const routePlans = pgTable('route_plans', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  caregiverId: text('caregiver_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  date: date('date').notNull(),
  totalDistanceMiles: decimal('total_distance_miles', { precision: 8, scale: 2 }),
  totalDurationMinutes: integer('total_duration_minutes'),
  optimizedAt: timestamp('optimized_at'),
  status: text('status').default('draft').notNull(),
  totalServiceMinutes: integer('total_service_minutes'),
  stopCount: integer('stop_count'),
  notes: text('notes'),
  createdById: text('created_by_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('route_plans_company_id_idx').on(t.companyId),
  index('route_plans_caregiver_date_idx').on(t.caregiverId, t.date),
])

export const routePlanStops = pgTable('route_plan_stops', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  routePlanId: text('route_plan_id').notNull().references(() => routePlans.id, { onDelete: 'cascade' }),
  clientId: text('client_id').references(() => clients.id),
  stopOrder: integer('stop_order').notNull(),
  address: text('address'),
  latitude: decimal('latitude', { precision: 10, scale: 8 }),
  longitude: decimal('longitude', { precision: 11, scale: 8 }),
  arrivalTime: timestamp('arrival_time'),
  departureTime: timestamp('departure_time'),
  distanceFromPrevMiles: decimal('distance_from_prev_miles', { precision: 8, scale: 2 }),
  durationFromPrevMinutes: integer('duration_from_prev_minutes'),
  serviceUnits: integer('service_units'),
  notes: text('notes'),
  // Live route tracking: pending → en_route → arrived → in_progress → completed | skipped
  status: text('status').default('pending').notNull(),
  actualArrival: timestamp('actual_arrival'),
  actualDeparture: timestamp('actual_departure'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('route_plan_stops_company_id_idx').on(t.companyId),
  index('route_plan_stops_route_plan_id_idx').on(t.routePlanId),
])

export const optimizerRuns = pgTable('optimizer_runs', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  runType: text('run_type').notNull(),
  status: text('status').default('pending').notNull(),
  inputParams: json('input_params'),
  resultSummary: json('result_summary'),
  errorMessage: text('error_message'),
  durationMs: integer('duration_ms'),
  createdById: text('created_by_id').references(() => user.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('optimizer_runs_company_id_idx').on(t.companyId),
])

export const serviceCapabilities = pgTable('service_capabilities', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  category: text('category'),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('service_capabilities_company_id_idx').on(t.companyId),
])

export const caregiverCapabilities = pgTable('caregiver_capabilities', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  caregiverId: text('caregiver_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  capabilityId: text('capability_id').notNull().references(() => serviceCapabilities.id, { onDelete: 'cascade' }),
  proficiencyLevel: text('proficiency_level').default('basic'),
  certifiedDate: date('certified_date'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('caregiver_capabilities_company_id_idx').on(t.companyId),
  uniqueIndex('caregiver_capabilities_caregiver_capability_idx').on(t.caregiverId, t.capabilityId),
  index('caregiver_capabilities_caregiver_id_idx').on(t.caregiverId),
])

export const clientCaregiverRestrictions = pgTable('client_caregiver_restrictions', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  clientId: text('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
  caregiverId: text('caregiver_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  restrictionType: text('restriction_type').default('do_not_assign').notNull(),
  reason: text('reason'),
  createdById: text('created_by_id').references(() => user.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('client_caregiver_restrictions_company_id_idx').on(t.companyId),
  uniqueIndex('client_caregiver_restrictions_pair_idx').on(t.clientId, t.caregiverId),
  index('client_caregiver_restrictions_client_id_idx').on(t.clientId),
  index('client_caregiver_restrictions_caregiver_id_idx').on(t.caregiverId),
])

export const complianceDocuments = pgTable('compliance_documents', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  description: text('description'),
  category: text('category'),
  documentUrl: text('document_url'),
  requiresAcknowledgment: boolean('requires_acknowledgment').default(false).notNull(),
  effectiveDate: date('effective_date'),
  expiryDate: date('expiry_date'),
  isActive: boolean('is_active').default(true).notNull(),
  createdById: text('created_by_id').references(() => user.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('compliance_documents_company_id_idx').on(t.companyId),
  index('compliance_documents_category_idx').on(t.category),
])

export const documentAcknowledgments = pgTable('document_acknowledgments', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  documentId: text('document_id').notNull().references(() => complianceDocuments.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  acknowledgedAt: timestamp('acknowledged_at').defaultNow().notNull(),
  signatureData: text('signature_data'),
}, (t) => [
  index('document_acknowledgments_company_id_idx').on(t.companyId),
  uniqueIndex('document_acknowledgments_doc_user_idx').on(t.documentId, t.userId),
  index('document_acknowledgments_document_id_idx').on(t.documentId),
])

export const applicationStatusHistory = pgTable('application_status_history', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  applicationId: text('application_id').notNull().references(() => applications.id, { onDelete: 'cascade' }),
  status: text('status').notNull(),
  notes: text('notes'),
  changedById: text('changed_by_id').references(() => user.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('application_status_history_company_id_idx').on(t.companyId),
  index('application_status_history_application_id_idx').on(t.applicationId),
])

export const familyMembers = pgTable('family_members', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  clientId: text('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  relationship: text('relationship'),
  email: text('email'),
  phone: text('phone'),
  passwordHash: text('password_hash'),
  portalToken: text('portal_token'),
  portalTokenExp: timestamp('portal_token_exp'),
  lastLoginAt: timestamp('last_login_at'),
  isActive: boolean('is_active').default(true).notNull(),
  // What this relative may see in the family portal.
  canViewSchedule: boolean('can_view_schedule').default(true).notNull(),
  canViewCarePlan: boolean('can_view_care_plan').default(true).notNull(),
  canViewMedications: boolean('can_view_medications').default(false).notNull(),
  canMessage: boolean('can_message').default(true).notNull(),
  isPrimaryContact: boolean('is_primary_contact').default(false).notNull(),
  // Asked for by the relative: a text from the agency when the caregiver arrives and when they leave (core/familyTexts.ts). Off until the office records the yes; visitTextOptInAt is when.
  visitTextOptIn: boolean('visit_text_optin').default(false).notNull(),
  visitTextOptInAt: timestamp('visit_text_optin_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('family_members_company_id_idx').on(t.companyId),
  index('family_members_client_id_idx').on(t.clientId),
  index('family_members_email_idx').on(t.email),
])

export const familyMessages = pgTable('family_messages', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  familyMemberId: text('family_member_id').notNull().references(() => familyMembers.id, { onDelete: 'cascade' }),
  clientId: text('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
  senderType: text('sender_type').notNull(), // 'family' (inbound) or 'staff' (outbound)
  senderName: text('sender_name'),
  subject: text('subject'),
  body: text('body').notNull(),
  isRead: boolean('is_read').default(false).notNull(),
  // The office's answer, kept on the family's message as well as sent as its own row.
  reply: text('reply'),
  repliedAt: timestamp('replied_at'),
  repliedById: text('replied_by_id').references(() => user.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('family_messages_company_id_idx').on(t.companyId),
  index('family_messages_family_member_id_idx').on(t.familyMemberId),
  index('family_messages_client_id_idx').on(t.clientId),
])

export const scheduleExceptions = pgTable('schedule_exceptions', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  scheduleId: text('schedule_id').notNull().references(() => schedules.id, { onDelete: 'cascade' }),
  exceptionDate: date('exception_date').notNull(),
  exceptionType: text('exception_type').notNull(), // 'cancelled' or 'modified'
  // Override fields (only used when exceptionType = 'modified')
  overrideStartTime: time('override_start_time'),
  overrideEndTime: time('override_end_time'),
  overrideCaregiverId: text('override_caregiver_id').references(() => user.id),
  overrideClientId: text('override_client_id').references(() => clients.id),
  overrideNotes: text('override_notes'),
  createdBy: text('created_by').references(() => user.id),
  // Why a cancelled occurrence was cancelled (0016_visits) — see src/helpers/cancelReasons.ts.
  cancelReason: text('cancel_reason'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('schedule_exceptions_company_id_idx').on(t.companyId),
  uniqueIndex('schedule_exceptions_schedule_date_idx').on(t.scheduleId, t.exceptionDate),
  index('schedule_exceptions_schedule_id_idx').on(t.scheduleId),
  index('schedule_exceptions_date_idx').on(t.exceptionDate),
])

export const payrollShiftReviews = pgTable('payroll_shift_reviews', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  payPeriodStart: date('pay_period_start').notNull(),
  payPeriodEnd: date('pay_period_end').notNull(),
  caregiverId: text('caregiver_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  clientId: text('client_id').references(() => clients.id, { onDelete: 'set null' }),
  scheduleId: text('schedule_id').references(() => schedules.id, { onDelete: 'set null' }),
  timeEntryId: text('time_entry_id').references(() => timeEntries.id, { onDelete: 'set null' }),
  shiftDate: date('shift_date').notNull(),
  // Scheduled shift info (from schedule)
  scheduledStart: time('scheduled_start'),
  scheduledEnd: time('scheduled_end'),
  scheduledMinutes: integer('scheduled_minutes'),
  // Actual clock-in/out info (from time_entry)
  actualStart: timestamp('actual_start'),
  actualEnd: timestamp('actual_end'),
  actualMinutes: integer('actual_minutes'),
  // What gets paid
  payableMinutes: integer('payable_minutes'),
  // Status: pending, verified, approved, flagged, missing_punch, excused, manual_entry
  status: text('status').default('pending').notNull(),
  flagReason: text('flag_reason'),
  resolutionNotes: text('resolution_notes'),
  reviewedBy: text('reviewed_by').references(() => user.id),
  reviewedAt: timestamp('reviewed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('payroll_shift_reviews_company_id_idx').on(t.companyId),
  index('payroll_shift_reviews_period_idx').on(t.payPeriodStart, t.payPeriodEnd),
  index('payroll_shift_reviews_caregiver_idx').on(t.caregiverId),
  index('payroll_shift_reviews_status_idx').on(t.status),
])

export const caregiverRates = pgTable('caregiver_rates', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  caregiverId: text('caregiver_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  rateType: text('rate_type').default('base').notNull(), // base, overtime, premium
  hourlyRate: decimal('hourly_rate', { precision: 8, scale: 2 }).notNull(),
  effectiveDate: date('effective_date').notNull(),
  endDate: date('end_date'),
  notes: text('notes'),
  createdById: text('created_by_id').references(() => user.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('caregiver_rates_company_id_idx').on(t.companyId),
  index('caregiver_rates_caregiver_idx').on(t.caregiverId),
  index('caregiver_rates_effective_date_idx').on(t.effectiveDate),
])

export const certificationAlerts = pgTable('certification_alerts', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  caregiverId: text('caregiver_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  certificationRecordId: text('certification_record_id').references(() => certificationRecords.id, { onDelete: 'cascade' }),
  certificationType: text('certification_type').notNull(),
  expiryDate: date('expiry_date').notNull(),
  alertType: text('alert_type').default('expiring_soon').notNull(),
  daysUntilExpiry: integer('days_until_expiry'),
  status: text('status').default('active').notNull(),
  acknowledgedAt: timestamp('acknowledged_at'),
  acknowledgedById: text('acknowledged_by_id').references(() => user.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('certification_alerts_company_id_idx').on(t.companyId),
  index('certification_alerts_caregiver_idx').on(t.caregiverId),
  index('certification_alerts_status_idx').on(t.status),
])

// One reminder per (credential, expiry date, stage) — stage '30', '14' or '0' days before it expires. The unique key is
// how the daily scan sends each reminder once, across restarts and across instances (core/certReminders.ts). A renewed
// credential has a new expiry date, so its reminders start over.
export const certificationReminder = pgTable('certification_reminder', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  certificationRecordId: text('certification_record_id').notNull().references(() => certificationRecords.id, { onDelete: 'cascade' }),
  caregiverId: text('caregiver_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  stage: text('stage').notNull(),
  expiryDate: date('expiry_date').notNull(),
  sentAt: timestamp('sent_at').defaultNow().notNull(),
}, (t) => [
  index('certification_reminder_company_id_idx').on(t.companyId),
  uniqueIndex('certification_reminder_key').on(t.certificationRecordId, t.expiryDate, t.stage),
])

// One row per (visit, relative, arrival or departure): the claim that makes each family text send once — across a
// replayed or offline punch and across instances — and the record of what happened to it: 'sent', 'failed' (the text
// service could not send), or 'skipped_quiet' / 'skipped_late' (the agency's quiet hours; a punch saved hours before it
// reached us).
export const familyVisitText = pgTable('family_visit_text', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  timeEntryId: text('time_entry_id').notNull().references(() => timeEntries.id, { onDelete: 'cascade' }),
  familyMemberId: text('family_member_id').notNull().references(() => familyMembers.id, { onDelete: 'cascade' }),
  event: text('event').notNull(),
  status: text('status').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('family_visit_text_company_id_idx').on(t.companyId),
  uniqueIndex('family_visit_text_key').on(t.timeEntryId, t.familyMemberId, t.event),
])

export const payrollRecords = pgTable('payroll_records', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  caregiverId: text('caregiver_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  periodStart: date('period_start').notNull(),
  periodEnd: date('period_end').notNull(),
  regularHours: decimal('regular_hours', { precision: 8, scale: 2 }).default('0').notNull(),
  overtimeHours: decimal('overtime_hours', { precision: 8, scale: 2 }).default('0').notNull(),
  holidayHours: decimal('holiday_hours', { precision: 8, scale: 2 }).default('0').notNull(),
  regularRate: decimal('regular_rate', { precision: 8, scale: 2 }),
  overtimeRate: decimal('overtime_rate', { precision: 8, scale: 2 }),
  grossPay: decimal('gross_pay', { precision: 12, scale: 2 }),
  mileageReimbursement: decimal('mileage_reimbursement', { precision: 8, scale: 2 }).default('0'),
  status: text('status').default('draft').notNull(),
  approvedAt: timestamp('approved_at'),
  approvedById: text('approved_by_id').references(() => user.id),
  processedAt: timestamp('processed_at'),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('payroll_records_company_id_idx').on(t.companyId),
  index('payroll_records_caregiver_id_idx').on(t.caregiverId),
  index('payroll_records_period_idx').on(t.periodStart, t.periodEnd),
  uniqueIndex('payroll_records_caregiver_period_idx').on(t.caregiverId, t.periodStart, t.periodEnd),
])

export const payrollLineItems = pgTable('payroll_line_items', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  payrollRecordId: text('payroll_record_id').notNull().references(() => payrollRecords.id, { onDelete: 'cascade' }),
  timeEntryId: text('time_entry_id').references(() => timeEntries.id),
  clientId: text('client_id').references(() => clients.id),
  date: date('date').notNull(),
  hours: decimal('hours', { precision: 6, scale: 2 }).notNull(),
  rate: decimal('rate', { precision: 8, scale: 2 }).notNull(),
  amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
  payType: text('pay_type').default('regular').notNull(),
  description: text('description'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('payroll_line_items_company_id_idx').on(t.companyId),
  index('payroll_line_items_payroll_record_id_idx').on(t.payrollRecordId),
])

export const clientDocumentTemplates = pgTable('client_document_templates', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  key: text('key').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  requiresRelationship: boolean('requires_relationship').default(true).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  sortOrder: integer('sort_order').default(0).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('client_document_templates_company_id_idx').on(t.companyId),
  uniqueIndex('client_document_templates_key_idx').on(t.key),
])

export const clientDocuments = pgTable('client_documents', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  clientId: text('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
  templateId: text('template_id').references(() => clientDocumentTemplates.id, { onDelete: 'set null' }),
  documentKey: text('document_key').notNull(),
  title: text('title').notNull(),
  // Snapshot of the exact text presented. Editing the template later must not
  // change what somebody already signed.
  body: text('body').notNull(),
  status: text('status').default('sent').notNull(),
  sentAt: timestamp('sent_at').defaultNow().notNull(),
  viewedAt: timestamp('viewed_at'),
  signedAt: timestamp('signed_at'),
  signedBy: text('signed_by'),
  signerRelationship: text('signer_relationship'),
  signedIp: text('signed_ip'),
  signedUserAgent: text('signed_user_agent'),
  signatureImage: text('signature_image'),
  consentAt: timestamp('consent_at'),
  documentHash: text('document_hash'),
  declinedAt: timestamp('declined_at'),
  declineReason: text('decline_reason'),
  voidedAt: timestamp('voided_at'),
  createdById: text('created_by_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('client_documents_company_id_idx').on(t.companyId),
  index('client_documents_client_id_idx').on(t.clientId),
  index('client_documents_status_idx').on(t.status),
])

// A client's recurring checklist: what the caregiver does on a shift. weekly_frequency x
// allotted_minutes is the assessed minutes per week; it is derived on read, never stored.
export const clientTaskTemplates = pgTable('client_task_templates', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  clientId: text('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
  taskName: text('task_name').notNull(),
  description: text('description'),
  category: text('category').default('other').notNull(),
  allottedMinutes: integer('allotted_minutes').default(0).notNull(),
  weeklyFrequency: integer('weekly_frequency').default(1).notNull(),
  daysOfWeek: text('days_of_week'),
  timeOfDay: text('time_of_day').default('any').notNull(),
  // where the row came from, e.g. an insurer assessment import ('midas_shc_pc_summary')
  assessmentSource: text('assessment_source'),
  // 'daily' = every shift; 'weekly' = once a week
  cadence: text('cadence').default('daily').notNull(),
  // Item 12: a required task blocks the caregiver's clock-out until it is done, or skipped / refused with a reason.
  // Only enforced for agencies with the care_required_tasks feature.
  isRequired: boolean('is_required').default(false).notNull(),
  sortOrder: integer('sort_order').default(0).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdById: text('created_by_id').references(() => user.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('client_task_templates_company_id_idx').on(t.companyId),
  index('client_task_templates_client_active_idx').on(t.clientId, t.isActive),
  check('client_task_templates_category_check', clientTaskTemplatesCategoryCheck(t)),
  check('client_task_templates_time_of_day_check', clientTaskTemplatesTimeOfDayCheck(t)),
  check('client_task_templates_cadence_check', clientTaskTemplatesCadenceCheck(t)),
])

export const shiftTaskCompletions = pgTable('shift_task_completions', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  timeEntryId: text('time_entry_id').notNull().references(() => timeEntries.id, { onDelete: 'cascade' }),
  taskTemplateId: text('task_template_id').notNull().references(() => clientTaskTemplates.id, { onDelete: 'cascade' }),
  status: text('status').default('pending').notNull(),
  notes: text('notes'),
  completedAt: timestamp('completed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('shift_task_completions_company_id_idx').on(t.companyId),
  uniqueIndex('shift_task_completions_entry_task_idx').on(t.timeEntryId, t.taskTemplateId),
  index('shift_task_completions_time_entry_idx').on(t.timeEntryId),
  check('shift_task_completions_status_check', shiftTaskCompletionsStatusCheck(t)),
])

export const carePlanTemplates = pgTable('care_plan_templates', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  templateName: text('template_name').notNull(),
  templateDescription: text('template_description'),
  category: text('category'),
  serviceType: text('service_type'),
  serviceDescription: text('service_description'),
  frequency: text('frequency'),
  careGoals: text('care_goals'),
  specialInstructions: text('special_instructions'),
  precautions: text('precautions'),
  medicationNotes: text('medication_notes'),
  mobilityNotes: text('mobility_notes'),
  dietaryNotes: text('dietary_notes'),
  communicationNotes: text('communication_notes'),
  isBuiltIn: boolean('is_built_in').default(false).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdById: text('created_by_id').references(() => user.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('care_plan_templates_company_id_idx').on(t.companyId),
  index('care_plan_templates_active_idx').on(t.isActive),
  index('care_plan_templates_category_idx').on(t.category),
])

// The OLD row of a care plan, written by the trg_snapshot_care_plan trigger on every update
// that changes its content (see 0017_care.sql). Never written by application code.
export const carePlanRevisions = pgTable('care_plan_revisions', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  carePlanId: text('care_plan_id').notNull().references(() => carePlans.id, { onDelete: 'cascade' }),
  revisionNumber: integer('revision_number').notNull(),
  changedAt: timestamp('changed_at').defaultNow().notNull(),
  changedById: text('changed_by_id'),
  serviceType: text('service_type'),
  serviceDescription: text('service_description'),
  frequency: text('frequency'),
  careGoals: text('care_goals'),
  specialInstructions: text('special_instructions'),
  precautions: text('precautions'),
  medicationNotes: text('medication_notes'),
  mobilityNotes: text('mobility_notes'),
  dietaryNotes: text('dietary_notes'),
  communicationNotes: text('communication_notes'),
  startDate: date('start_date'),
  endDate: date('end_date'),
  status: text('status'),
  visitSchedule: text('visit_schedule'),
  visitScheduleAsOf: date('visit_schedule_as_of'),
}, (t) => [
  index('care_plan_revisions_company_id_idx').on(t.companyId),
  uniqueIndex('care_plan_revisions_plan_rev_idx').on(t.carePlanId, t.revisionNumber),
])

export const clientVitals = pgTable('client_vitals', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  clientId: text('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
  caregiverId: text('caregiver_id').references(() => user.id),
  timeEntryId: text('time_entry_id').references(() => timeEntries.id, { onDelete: 'set null' }),
  recordedAt: timestamp('recorded_at').defaultNow().notNull(),
  systolicBp: integer('systolic_bp'),
  diastolicBp: integer('diastolic_bp'),
  pulse: integer('pulse'),
  respirations: integer('respirations'),
  oxygenSaturation: integer('oxygen_saturation'),
  temperatureF: decimal('temperature_f', { precision: 4, scale: 1 }),
  bloodGlucose: integer('blood_glucose'),
  weightLbs: decimal('weight_lbs', { precision: 5, scale: 1 }),
  painScale: integer('pain_scale'),
  painLocation: text('pain_location'),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('client_vitals_company_id_idx').on(t.companyId),
  index('client_vitals_client_idx').on(t.clientId),
  index('client_vitals_recorded_idx').on(t.recordedAt),
  index('client_vitals_caregiver_idx').on(t.caregiverId),
  check('vitals_systolic_range', vitalsSystolicRange(t)),
  check('vitals_diastolic_range', vitalsDiastolicRange(t)),
  check('vitals_pulse_range', vitalsPulseRange(t)),
  check('vitals_resp_range', vitalsRespRange(t)),
  check('vitals_o2_range', vitalsO2Range(t)),
  check('vitals_temp_range', vitalsTempRange(t)),
  check('vitals_glucose_range', vitalsGlucoseRange(t)),
  check('vitals_weight_range', vitalsWeightRange(t)),
  check('vitals_pain_range', vitalsPainRange(t)),
])

// The agency's document store: files kept against a client, a caregiver, or the company
// (policies everyone signs). A document can require a signature; the latest one is kept on the
// row for a quick read and every signature is kept in document_signatures.
export const documents = pgTable('documents', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  entityType: text('entity_type').notNull(), // client | caregiver | company
  entityId: text('entity_id'),
  documentType: text('document_type').default('other').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  fileUrl: text('file_url'),
  fileName: text('file_name'),
  fileType: text('file_type'),
  fileSize: integer('file_size'),
  // the file itself, base64 — a Render disk is wiped on every deploy
  fileData: text('file_data'),
  requiresSignature: boolean('requires_signature').default(false).notNull(),
  expirationDate: date('expiration_date'),
  isConfidential: boolean('is_confidential').default(false).notNull(),
  uploadedById: text('uploaded_by_id').references(() => user.id),
  signedAt: timestamp('signed_at'),
  signedById: text('signed_by_id').references(() => user.id),
  signatureImage: text('signature_image'),
  signatureIp: text('signature_ip'),
  signatureUserAgent: text('signature_user_agent'),
  signatureTypedName: text('signature_typed_name'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('documents_company_id_idx').on(t.companyId),
  index('documents_entity_idx').on(t.entityType, t.entityId),
  index('documents_expiration_idx').on(t.expirationDate),
  check('documents_entity_type_check', documentsEntityTypeCheck(t)),
])

export const documentSignatures = pgTable('document_signatures', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  documentId: text('document_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
  signedById: text('signed_by_id').notNull().references(() => user.id),
  signerRole: text('signer_role'),
  signerTypedName: text('signer_typed_name'),
  signatureImage: text('signature_image').notNull(),
  signedAt: timestamp('signed_at').defaultNow().notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
}, (t) => [
  index('document_signatures_company_id_idx').on(t.companyId),
  index('document_signatures_document_idx').on(t.documentId),
  index('document_signatures_signer_idx').on(t.signedById),
])

// Admin-managed openings for the public careers page. No published, open posting: the careers
// page shows the general "always building our caregiver pool" copy and still takes applications.
export const jobPostings = pgTable('job_postings', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  slug: text('slug').notNull().unique(),
  employmentType: text('employment_type').default('part_time').notNull(), // full_time | part_time | prn | contract
  location: text('location'),
  payRangeMin: decimal('pay_range_min', { precision: 10, scale: 2 }),
  payRangeMax: decimal('pay_range_max', { precision: 10, scale: 2 }),
  payRateUnit: text('pay_rate_unit').default('hour').notNull(), // hour | week | year | visit
  summary: text('summary'),
  description: text('description').notNull(),
  responsibilities: text('responsibilities'),
  qualifications: text('qualifications'),
  isPublished: boolean('is_published').default(false).notNull(),
  publishedAt: timestamp('published_at'),
  closesAt: timestamp('closes_at'), // null = open indefinitely
  applicationsCount: integer('applications_count').default(0).notNull(),
  createdById: text('created_by_id').references(() => user.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('job_postings_company_id_idx').on(t.companyId),
  index('job_postings_published_idx').on(t.isPublished, t.closesAt),
])

// Post-hire onboarding packet: a tokenized link emailed to the new hire. Captures the deeper
// personal details, the background-check consent (FCRA-style standalone disclosure + typed
// signature + IP + user agent) and, where the agency runs WORCS, the SSN for that one submission.
export const onboardingPackets = pgTable('onboarding_packets', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  caregiverId: text('caregiver_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  applicationId: text('application_id').references(() => applications.id, { onDelete: 'set null' }),
  token: text('token').notNull().unique(),
  expiresAt: timestamp('expires_at').notNull(),
  status: text('status').default('sent').notNull(), // sent | opened | in_progress | submitted | expired | cancelled
  preferredName: text('preferred_name'),
  legalFirstName: text('legal_first_name'),
  legalMiddleName: text('legal_middle_name'),
  legalLastName: text('legal_last_name'),
  pronouns: text('pronouns'),
  address: text('address'),
  city: text('city'),
  state: text('state'),
  zip: text('zip'),
  dateOfBirth: date('date_of_birth'),
  driversLicenseNumber: text('drivers_license_number'),
  driversLicenseState: text('drivers_license_state'),
  emergencyContactName: text('emergency_contact_name'),
  emergencyContactRelationship: text('emergency_contact_relationship'),
  emergencyContactPhone: text('emergency_contact_phone'),
  emergencyContactEmail: text('emergency_contact_email'),
  bgcConsentSignedAt: timestamp('bgc_consent_signed_at'),
  bgcConsentSignature: text('bgc_consent_signature'),
  bgcConsentIp: text('bgc_consent_ip'),
  bgcConsentUserAgent: text('bgc_consent_user_agent'),
  bgcConsentVersion: text('bgc_consent_version'),
  bgcConsentDisclosureText: text('bgc_consent_disclosure_text'),
  // Encrypted SSN held ONLY until the WORCS submission succeeds, then nulled.
  ssnTransientEncrypted: text('ssn_transient_encrypted'),
  openedAt: timestamp('opened_at'),
  submittedAt: timestamp('submitted_at'),
  createdById: text('created_by_id').references(() => user.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('onboarding_packets_company_id_idx').on(t.companyId),
  index('onboarding_packets_caregiver_idx').on(t.caregiverId),
  index('onboarding_packets_status_idx').on(t.status),
  index('onboarding_packets_expires_idx').on(t.expiresAt),
])

// Append-only audit trail for a packet: every view, save, signature and background-check request.
export const onboardingPacketEvents = pgTable('onboarding_packet_events', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  packetId: text('packet_id').notNull().references(() => onboardingPackets.id, { onDelete: 'cascade' }),
  // created | emailed | opened | saved_draft | consent_signed | submitted | bgc_requested |
  // bgc_completed | expired | cancelled | resent
  eventType: text('event_type').notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  metadata: json('metadata'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('onboarding_packet_events_company_id_idx').on(t.companyId),
  index('onboarding_packet_events_packet_idx').on(t.packetId, t.createdAt),
])

// Statutory caregiver bar list the eligibility engine matches background-check findings against.
// Rows carry the state whose law they come from; the engine only uses the agency's own state.
// Seeded with Wisconsin (Wis. Stat. 50.065 / 48.685, DHS 12) for agencies in WI.
export const caregiverDisqualifiers = pgTable('caregiver_disqualifiers', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  state: text('state'), // two-letter state the statute belongs to
  category: text('category').notNull(),
  statute: text('statute').notNull(),
  shortTitle: text('short_title').notNull(),
  description: text('description'),
  severity: text('severity').notNull(), // permanent_bar | rehab_review | advisory
  matchPatterns: json('match_patterns').default([]).notNull(), // case-insensitive regex fragments
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('caregiver_disqualifiers_company_id_idx').on(t.companyId),
  index('caregiver_disqualifiers_active_idx').on(t.isActive, t.severity),
  index('caregiver_disqualifiers_state_idx').on(t.state),
])

// Result letters for a background check, stored in the database as data URIs (local disk does not
// survive a deploy). Admin only.
export const backgroundCheckDocuments = pgTable('background_check_documents', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  backgroundCheckId: text('background_check_id').notNull().references(() => backgroundChecks.id, { onDelete: 'cascade' }),
  fileName: text('file_name').notNull(),
  mimeType: text('mime_type').notNull(),
  fileSize: integer('file_size'),
  fileData: text('file_data').notNull(),
  uploadedById: text('uploaded_by_id').references(() => user.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('background_check_documents_company_id_idx').on(t.companyId),
  index('background_check_documents_check_idx').on(t.backgroundCheckId, t.createdAt),
])

// Caregivers confirm or dispute their pay-period hours before payroll runs. One row per
// (caregiver, pay period); either verified_at or disputed_at is set.
export const payrollPeriodVerifications = pgTable('payroll_period_verifications', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  caregiverId: text('caregiver_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  payPeriodStart: date('pay_period_start').notNull(),
  payPeriodEnd: date('pay_period_end').notNull(),
  verifiedAt: timestamp('verified_at'),
  disputedAt: timestamp('disputed_at'),
  disputeReason: text('dispute_reason'),
  reportedTotalHours: decimal('reported_total_hours', { precision: 10, scale: 2 }),
  reportedGrossPay: decimal('reported_gross_pay', { precision: 10, scale: 2 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('payroll_period_verifications_company_id_idx').on(t.companyId),
  uniqueIndex('payroll_period_verifications_caregiver_period_idx').on(t.caregiverId, t.payPeriodStart, t.payPeriodEnd),
])

// Client portal logins: one per PERSON, several per client (the client and each
// relative), each with its own password, lockout counter and invite/reset link.
// Replaces the single login that lived on clients.portal_email/portal_password_hash
// (the migration copies it across). clients.portal_token stays: it is the emailed
// direct-link credential used by /portal?token= and by signable-document emails.
export const clientPortalAccounts = pgTable('client_portal_accounts', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  clientId: text('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
  email: text('email').notNull(), // lowercase; the login key, unique across all clients
  displayName: text('display_name'), // who this login belongs to, e.g. "Tyler (son)"
  passwordHash: text('password_hash'),
  portalEnabled: boolean('portal_enabled').default(false).notNull(),
  failedLoginCount: integer('failed_login_count').default(0).notNull(),
  lockedUntil: timestamp('locked_until'),
  inviteToken: text('invite_token'),
  inviteExpiresAt: timestamp('invite_expires_at'),
  lastLogin: timestamp('last_login'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('client_portal_accounts_company_id_idx').on(t.companyId),
  uniqueIndex('client_portal_accounts_email_idx').on(t.email),
  index('client_portal_accounts_client_id_idx').on(t.clientId),
  index('client_portal_accounts_invite_token_idx').on(t.inviteToken),
])

// A client's own notification switches (created by 0005, declared here since 0020).
export const clientNotificationPreferences = pgTable('client_notification_preferences', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  clientId: text('client_id').notNull().unique('client_notification_preferences_client_id_key').references(() => clients.id, { onDelete: 'cascade' }),
  emailEnabled: boolean('email_enabled').default(true),
  portalEnabled: boolean('portal_enabled').default(true),
  caregiverAlerts: boolean('caregiver_alerts').default(true),
  scheduleAlerts: boolean('schedule_alerts').default(true),
  billingAlerts: boolean('billing_alerts').default(true),
  assignmentAlerts: boolean('assignment_alerts').default(true),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (t) => [
  index('client_notification_preferences_company_id_idx').on(t.companyId),
])

// A cancel or reschedule asked for by the client (portal), the caregiver or the office.
// status: pending | approved | denied | counter_offered | counter_accepted | counter_declined
export const visitChangeRequests = pgTable('visit_change_requests', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  clientId: text('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
  caregiverId: text('caregiver_id').notNull().references(() => user.id),
  requestType: text('request_type').notNull(), // cancel | reschedule
  visitId: text('visit_id'),
  scheduleId: text('schedule_id').references(() => schedules.id, { onDelete: 'set null' }),
  visitDate: date('visit_date').notNull(),
  originalStartTime: time('original_start_time').notNull(),
  originalEndTime: time('original_end_time').notNull(),
  cancelReason: text('cancel_reason'),
  proposedDate: date('proposed_date'),
  proposedStartTime: time('proposed_start_time'),
  proposedEndTime: time('proposed_end_time'),
  counterDate: date('counter_date'),
  counterStartTime: time('counter_start_time'),
  counterEndTime: time('counter_end_time'),
  counterMessage: text('counter_message'),
  status: text('status').default('pending').notNull(),
  requestedBy: text('requested_by').default('client').notNull(), // client | caregiver | admin
  requestReason: text('request_reason'),
  appliedScheduleId: text('applied_schedule_id').references(() => schedules.id, { onDelete: 'set null' }),
  resolvedAt: timestamp('resolved_at'),
  resolvedById: text('resolved_by_id').references(() => user.id),
  adminNotes: text('admin_notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('visit_change_requests_company_id_idx').on(t.companyId),
  index('visit_change_requests_client_id_idx').on(t.clientId),
  index('visit_change_requests_caregiver_id_idx').on(t.caregiverId),
  index('visit_change_requests_status_created_idx').on(t.status, t.createdAt),
  index('visit_change_requests_visit_date_idx').on(t.visitDate),
])

// Who accepted an open shift.
export const openShiftClaims = pgTable('open_shift_claims', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  openShiftId: text('open_shift_id').notNull().references(() => openShifts.id, { onDelete: 'cascade' }),
  caregiverId: text('caregiver_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  notes: text('notes'),
  status: text('status').default('pending').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('open_shift_claims_company_id_idx').on(t.companyId),
  index('open_shift_claims_open_shift_id_idx').on(t.openShiftId),
])

// Proof-of-care photos attached to a time entry. Stored as a data URI.
export const visitPhotos = pgTable('visit_photos', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  timeEntryId: text('time_entry_id').notNull().references(() => timeEntries.id, { onDelete: 'cascade' }),
  caregiverId: text('caregiver_id').references(() => user.id, { onDelete: 'set null' }),
  clientId: text('client_id').references(() => clients.id, { onDelete: 'set null' }),
  caption: text('caption'),
  category: text('category'), // meal | task | vitals | environment | other
  imageBase64: text('image_base64').notNull(),
  imageSize: integer('image_size'),
  takenAt: timestamp('taken_at').defaultNow().notNull(),
  uploadedAt: timestamp('uploaded_at').defaultNow().notNull(),
}, (t) => [
  index('visit_photos_company_id_idx').on(t.companyId),
  index('visit_photos_time_entry_id_idx').on(t.timeEntryId),
  index('visit_photos_client_id_idx').on(t.clientId),
  index('visit_photos_taken_at_idx').on(t.takenAt),
])

// One office-entered care note per visit (client + date + scheduled start + caregiver).
export const visitDocumentation = pgTable('visit_documentation', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  clientId: text('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
  caregiverId: text('caregiver_id').notNull().references(() => user.id),
  visitDate: date('visit_date').notNull(),
  startTime: time('start_time').notNull(),
  endTime: time('end_time').notNull(),
  scheduleId: text('schedule_id').references(() => schedules.id, { onDelete: 'set null' }),
  tasks: json('tasks').default([]).notNull(), // [{ taskId, taskName, done }] — a snapshot
  note: text('note'),
  enteredById: text('entered_by_id').references(() => user.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('visit_documentation_company_id_idx').on(t.companyId),
  uniqueIndex('visit_documentation_visit_idx').on(t.clientId, t.visitDate, t.startTime, t.caregiverId),
  index('visit_documentation_client_date_idx').on(t.clientId, t.visitDate),
])

// "Shift in 1 hour" sent at most once per schedule per day.
export const shiftReminderLog = pgTable('shift_reminder_log', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  scheduleId: text('schedule_id').notNull(),
  shiftDate: date('shift_date').notNull(),
  sentAt: timestamp('sent_at').defaultNow().notNull(),
}, (t) => [
  index('shift_reminder_log_company_id_idx').on(t.companyId),
  uniqueIndex('shift_reminder_log_key').on(t.scheduleId, t.shiftDate),
])

// Each over-visit-length threshold fires at most once per time entry.
export const overtimeAlertLog = pgTable('overtime_alert_log', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  timeEntryId: text('time_entry_id').notNull(),
  thresholdMin: integer('threshold_min').notNull(),
  sent: boolean('sent').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('overtime_alert_log_company_id_idx').on(t.companyId),
  uniqueIndex('overtime_alert_log_key').on(t.timeEntryId, t.thresholdMin),
])

// The caregiver app's Expo push tokens — one row per device; services/visitNotify.sendPush sends
// to them through Expo's push service beside web push.
export const expoPushTokens = pgTable('expo_push_tokens', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  token: text('token').notNull(),
  platform: text('platform'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  lastSeenAt: timestamp('last_seen_at').defaultNow().notNull(),
}, (t) => [
  index('expo_push_tokens_company_id_idx').on(t.companyId),
  uniqueIndex('expo_push_tokens_token_idx').on(t.token),
  index('expo_push_tokens_user_id_idx').on(t.userId),
])

// 0005 (CVHC v13). The client portal's visit list; 0016 added the client's note and the schedule it came from.
export const scheduledVisits = pgTable('scheduled_visits', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  clientId: text('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
  caregiverId: text('caregiver_id').references(() => user.id),
  visitDate: date('visit_date').notNull(),
  scheduledDate: date('scheduled_date'),
  startTime: time('start_time'),
  endTime: time('end_time'),
  status: text('status').default('scheduled'),
  notes: text('notes'),
  cancelledReason: text('cancelled_reason'),
  cancelledBy: text('cancelled_by').references(() => user.id),
  cancelledAt: timestamp('cancelled_at'),
  assignmentId: text('assignment_id'),
  createdBy: text('created_by').references(() => user.id),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  clientNotes: text('client_notes'),
  sourceScheduleId: text('source_schedule_id').references(() => schedules.id, { onDelete: 'set null' }),
}, (t) => [
  index('scheduled_visits_company_id_idx').on(t.companyId),
  index('idx_scheduled_visits_client').on(t.clientId),
])

// 0005 (CVHC v13)
export const clientVisitNotes = pgTable('client_visit_notes', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  clientId: text('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
  caregiverId: text('caregiver_id').references(() => user.id),
  note: text('note').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (t) => [
  index('client_visit_notes_company_id_idx').on(t.companyId),
  index('idx_visit_notes_client').on(t.clientId),
])

// 0005 (CVHC v13)
export const clientServices = pgTable('client_services', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  clientId: text('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
  servicePricingId: text('service_pricing_id').notNull(),
  isPrimary: boolean('is_primary').default(false),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (t) => [
  index('client_services_company_id_idx').on(t.companyId),
  index('idx_client_services_client').on(t.clientId),
])

// Item 11 (care_supervisory_visits): a supervisor's check-in on a client's care — in the home or by phone. The next one is
// due the agency's rule (60 or 90 days) after the last (data/homecareSupervisory.ts). Plain-English form, no medical terms.
export const supervisoryVisit = pgTable('supervisory_visit', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  clientId: text('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
  visitDate: date('visit_date').notNull(),
  supervisorId: text('supervisor_id').references(() => user.id),
  // the caregiver this visit looked at, when it was about one person's work
  caregiverId: text('caregiver_id').references(() => user.id),
  visitType: text('visit_type').default('home').notNull(),
  clientFeedback: text('client_feedback'),
  carePlanFollowed: boolean('care_plan_followed'),
  caregiverFeedback: text('caregiver_feedback'),
  concerns: text('concerns'),
  followUpNotes: text('follow_up_notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('supervisory_visit_company_client_idx').on(t.companyId, t.clientId, t.visitDate),
])

// Item 1 (care_import): one CSV import of clients, caregivers or recurring shifts, and the records it created, so the
// whole batch can be undone (core/csvImport.ts, data/homecareImport.ts). Only what the import CREATED is listed; a
// record that matched an existing one is skipped, never changed.
export const importBatch = pgTable('import_batch', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(), // 'clients' | 'caregivers' | 'schedules'
  fileName: text('file_name'),
  status: text('status').default('done').notNull(), // 'done' | 'undone'
  rowsInFile: integer('rows_in_file').default(0).notNull(),
  created: integer('created').default(0).notNull(),
  skippedDuplicates: integer('skipped_duplicates').default(0).notNull(),
  failed: integer('failed').default(0).notNull(),
  createdBy: text('created_by'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  undoneAt: timestamp('undone_at'),
  undoneBy: text('undone_by'),
}, (t) => [
  index('import_batch_company_idx').on(t.companyId, t.createdAt),
])

export const importBatchRecord = pgTable('import_batch_record', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  batchId: text('batch_id').notNull().references(() => importBatch.id, { onDelete: 'cascade' }),
  recordId: text('record_id').notNull(),
  line: integer('line'),
  undone: boolean('undone').default(false).notNull(),
}, (t) => [
  index('import_batch_record_batch_idx').on(t.batchId),
])
