import { pgTable, text, boolean, integer, decimal, timestamp, date, time, json, uniqueIndex, index } from 'drizzle-orm/pg-core'
import { createId } from '@paralleldrive/cuid2'

// ==================== AGENCY (TOP-LEVEL TENANT) ====================
export const agencies = pgTable('agencies', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  name: text('name').notNull(),
  legalName: text('legal_name'),
  slug: text('slug').notNull().unique(),
  email: text('email'),
  phone: text('phone'),
  address: text('address'),
  city: text('city'),
  state: text('state'),
  zip: text('zip'),
  primaryColor: text('primary_color').default('{{PRIMARY_COLOR}}').notNull(),
  secondaryColor: text('secondary_color'),
  logo: text('logo'),
  website: text('website'),
  licenseNumber: text('license_number'),
  npi: text('npi'),
  medicaidId: text('medicaid_id'),
  settings: json('settings').default({}).notNull(),
  stripeCustomerId: text('stripe_customer_id').unique(),
  subscriptionTier: text('subscription_tier'),
  twilioPhoneNumber: text('twilio_phone_number'),
  twilioAccountSid: text('twilio_account_sid'),
  twilioAuthToken: text('twilio_auth_token'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// ==================== USERS (ADMINS & CAREGIVERS) ====================
export const users = pgTable('users', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  firstName: text('first_name').notNull(),
  lastName: text('last_name').notNull(),
  phone: text('phone'),
  role: text('role').default('caregiver').notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  address: text('address'),
  city: text('city'),
  state: text('state'),
  zip: text('zip'),
  latitude: decimal('latitude', { precision: 10, scale: 8 }),
  longitude: decimal('longitude', { precision: 11, scale: 8 }),
  certifications: json('certifications').default([]).notNull(),
  certificationsExpiry: json('certifications_expiry').default([]).notNull(),
  defaultPayRate: decimal('default_pay_rate', { precision: 8, scale: 2 }),
  hireDate: date('hire_date'),
  emergencyContactName: text('emergency_contact_name'),
  emergencyContactPhone: text('emergency_contact_phone'),
  lastLogin: timestamp('last_login'),
  refreshToken: text('refresh_token'),
  resetToken: text('reset_token'),
  resetTokenExp: timestamp('reset_token_exp'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// ==================== CAREGIVER PROFILE (EXTENDED) ====================
export const caregiverProfiles = pgTable('caregiver_profiles', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  caregiverId: text('caregiver_id').notNull().unique().references(() => users.id, { onDelete: 'cascade' }),
  notes: text('notes'),
  capabilities: text('capabilities'),
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
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// ==================== CAREGIVER AVAILABILITY ====================
export const caregiverAvailability = pgTable('caregiver_availability', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  caregiverId: text('caregiver_id').notNull().unique().references(() => users.id, { onDelete: 'cascade' }),
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
})

// ==================== CAREGIVER SCHEDULES ====================
export const caregiverSchedules = pgTable('caregiver_schedules', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  caregiverId: text('caregiver_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
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
  index('caregiver_schedules_caregiver_id_idx').on(t.caregiverId),
  index('caregiver_schedules_date_idx').on(t.date),
])

// ==================== CAREGIVER TIME OFF ====================
export const caregiverTimeOff = pgTable('caregiver_time_off', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  caregiverId: text('caregiver_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  startDate: date('start_date').notNull(),
  endDate: date('end_date').notNull(),
  type: text('type').notNull(),
  reason: text('reason'),
  approvedById: text('approved_by_id'),
  status: text('status').default('pending').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('caregiver_time_off_caregiver_id_idx').on(t.caregiverId),
  index('caregiver_time_off_dates_idx').on(t.startDate, t.endDate),
])

// ==================== REFERRAL SOURCES / PAYERS ====================
export const referralSources = pgTable('referral_sources', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
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
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('referral_sources_type_idx').on(t.type),
  index('referral_sources_is_active_idx').on(t.isActive),
])

// ==================== CLIENTS ====================
export const clients = pgTable('clients', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  firstName: text('first_name').notNull(),
  lastName: text('last_name').notNull(),
  dateOfBirth: date('date_of_birth'),
  ssnEncrypted: text('ssn_encrypted'),
  gender: text('gender'),
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
  // Portal access fields
  portalEnabled: boolean('portal_enabled').default(false).notNull(),
  portalToken: text('portal_token'),
  portalTokenExp: timestamp('portal_token_exp'),
  lastPortalVisit: timestamp('last_portal_visit'),
  portalEmail: text('portal_email'),
  portalPasswordHash: text('portal_password_hash'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('clients_is_active_idx').on(t.isActive),
  index('clients_referred_by_id_idx').on(t.referredById),
])

// ==================== CLIENT EMERGENCY CONTACTS ====================
export const clientEmergencyContacts = pgTable('client_emergency_contacts', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  clientId: text('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  relationship: text('relationship'),
  phone: text('phone').notNull(),
  email: text('email'),
  isPrimary: boolean('is_primary').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('client_emergency_contacts_client_id_idx').on(t.clientId),
])

// ==================== CLIENT ONBOARDING CHECKLIST ====================
export const clientOnboarding = pgTable('client_onboarding', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
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
})

// ==================== CLIENT ASSIGNMENTS ====================
export const clientAssignments = pgTable('client_assignments', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  clientId: text('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
  caregiverId: text('caregiver_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  assignmentDate: date('assignment_date').notNull(),
  hoursPerWeek: decimal('hours_per_week', { precision: 5, scale: 2 }),
  payRate: decimal('pay_rate', { precision: 10, scale: 2 }),
  status: text('status').default('active').notNull(),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('client_assignments_client_id_idx').on(t.clientId),
  index('client_assignments_caregiver_id_idx').on(t.caregiverId),
  index('client_assignments_status_idx').on(t.status),
])

// ==================== SCHEDULES ====================
export const schedules = pgTable('schedules', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
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
  // Split shift support
  isSplitShift: boolean('is_split_shift').default(false),
  splitShiftGroupId: text('split_shift_group_id'),
  splitSegment: integer('split_segment'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('schedules_client_id_idx').on(t.clientId),
  index('schedules_caregiver_id_idx').on(t.caregiverId),
  index('schedules_split_group_idx').on(t.splitShiftGroupId),
])

// ==================== OPEN SHIFTS ====================
export const openShifts = pgTable('open_shifts', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  clientId: text('client_id'),
  date: date('date').notNull(),
  startTime: time('start_time'),
  endTime: time('end_time'),
  status: text('status').default('open').notNull(),
  notes: text('notes'),
  sourceAbsenceId: text('source_absence_id'),
  notifiedCaregiverCount: integer('notified_caregiver_count').default(0).notNull(),
  autoCreated: boolean('auto_created').default(false).notNull(),
  createdById: text('created_by_id').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('open_shifts_date_idx').on(t.date),
  index('open_shifts_status_idx').on(t.status),
])

// ==================== OPEN SHIFT NOTIFICATIONS ====================
export const openShiftNotifications = pgTable('open_shift_notifications', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  openShiftId: text('open_shift_id').notNull().references(() => openShifts.id, { onDelete: 'cascade' }),
  caregiverId: text('caregiver_id').notNull(),
  notifiedAt: timestamp('notified_at').defaultNow().notNull(),
  notificationType: text('notification_type').default('push').notNull(),
}, (t) => [
  uniqueIndex('open_shift_notifications_shift_caregiver_idx').on(t.openShiftId, t.caregiverId),
  index('open_shift_notifications_open_shift_id_idx').on(t.openShiftId),
])

// ==================== ABSENCES ====================
export const absences = pgTable('absences', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  caregiverId: text('caregiver_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  clientId: text('client_id').references(() => clients.id),
  date: date('date').notNull(),
  type: text('type').notNull(),
  reason: text('reason'),
  reportedById: text('reported_by_id').references(() => users.id),
  coverageNeeded: boolean('coverage_needed').default(true).notNull(),
  coverageAssignedTo: text('coverage_assigned_to').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('absences_caregiver_id_idx').on(t.caregiverId),
  index('absences_date_idx').on(t.date),
])

// ==================== TIME ENTRIES ====================
export const timeEntries = pgTable('time_entries', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  caregiverId: text('caregiver_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
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
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('time_entries_caregiver_id_idx').on(t.caregiverId),
  index('time_entries_client_id_idx').on(t.clientId),
  index('time_entries_start_time_idx').on(t.startTime),
  index('time_entries_schedule_id_idx').on(t.scheduleId),
])

// ==================== GPS TRACKING ====================
export const gpsTracking = pgTable('gps_tracking', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  caregiverId: text('caregiver_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  timeEntryId: text('time_entry_id').references(() => timeEntries.id),
  latitude: decimal('latitude', { precision: 10, scale: 8 }).notNull(),
  longitude: decimal('longitude', { precision: 11, scale: 8 }).notNull(),
  accuracy: integer('accuracy'),
  speed: decimal('speed', { precision: 6, scale: 2 }),
  heading: integer('heading'),
  timestamp: timestamp('timestamp').defaultNow().notNull(),
}, (t) => [
  index('gps_tracking_caregiver_id_idx').on(t.caregiverId),
  index('gps_tracking_time_entry_id_idx').on(t.timeEntryId),
  index('gps_tracking_timestamp_idx').on(t.timestamp),
])

// ==================== GEOFENCE SETTINGS ====================
export const geofenceSettings = pgTable('geofence_settings', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  clientId: text('client_id').notNull().unique().references(() => clients.id, { onDelete: 'cascade' }),
  radiusFeet: integer('radius_feet').default(300).notNull(),
  autoClockIn: boolean('auto_clock_in').default(true).notNull(),
  autoClockOut: boolean('auto_clock_out').default(true).notNull(),
  requireGps: boolean('require_gps').default(true).notNull(),
  notifyAdminOnOverride: boolean('notify_admin_on_override').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// ==================== SERVICE CODES ====================
export const serviceCodes = pgTable('service_codes', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  code: text('code').notNull(),
  modifier1: text('modifier1'),
  modifier2: text('modifier2'),
  description: text('description').notNull(),
  serviceCategory: text('service_category'),
  payerType: text('payer_type').default('all').notNull(),
  unitType: text('unit_type').default('15min').notNull(),
  ratePerUnit: decimal('rate_per_unit', { precision: 8, scale: 4 }),
  requiresEvv: boolean('requires_evv').default(true).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('service_codes_code_idx').on(t.code),
  index('service_codes_is_active_idx').on(t.isActive),
])

// ==================== AUTHORIZATIONS ====================
export const authorizations = pgTable('authorizations', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
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
  createdById: text('created_by_id').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('authorizations_client_id_idx').on(t.clientId),
  index('authorizations_dates_idx').on(t.startDate, t.endDate),
  index('authorizations_status_idx').on(t.status),
])

// ==================== EVV VISITS ====================
export const evvVisits = pgTable('evv_visits', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
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
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('evv_visits_client_date_idx').on(t.clientId, t.serviceDate),
  index('evv_visits_caregiver_id_idx').on(t.caregiverId),
  index('evv_visits_sandata_status_idx').on(t.sandataStatus),
])

// ==================== VALIDATION LOG ====================
export const validationLog = pgTable('validation_log', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  validationType: text('validation_type').notNull(),
  status: text('status').notNull(),
  message: text('message'),
  details: json('details'),
  resolvedAt: timestamp('resolved_at'),
  resolvedById: text('resolved_by_id').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('validation_log_entity_idx').on(t.entityId, t.entityType),
])

// ==================== INVOICES ====================
export const invoices = pgTable('invoices', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
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
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('invoices_client_id_idx').on(t.clientId),
  index('invoices_payment_status_idx').on(t.paymentStatus),
])

// ==================== INVOICE LINE ITEMS ====================
export const invoiceLineItems = pgTable('invoice_line_items', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  invoiceId: text('invoice_id').notNull().references(() => invoices.id, { onDelete: 'cascade' }),
  timeEntryId: text('time_entry_id').references(() => timeEntries.id),
  caregiverId: text('caregiver_id').notNull(),
  description: text('description').notNull(),
  hours: decimal('hours', { precision: 6, scale: 2 }).notNull(),
  rate: decimal('rate', { precision: 10, scale: 2 }).notNull(),
  amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('invoice_line_items_invoice_id_idx').on(t.invoiceId),
])

// ==================== EDI BATCHES ====================
export const ediBatches = pgTable('edi_batches', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  payerId: text('payer_id').references(() => referralSources.id),
  batchNumber: text('batch_number').notNull().unique(),
  status: text('status').default('draft').notNull(),
  claimCount: integer('claim_count').default(0).notNull(),
  totalBilled: decimal('total_billed', { precision: 10, scale: 2 }).default('0').notNull(),
  ediContent: text('edi_content'),
  submittedAt: timestamp('submitted_at'),
  responseCode: text('response_code'),
  responseMessage: text('response_message'),
  createdById: text('created_by_id').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('edi_batches_status_idx').on(t.status),
])

// ==================== CLAIMS ====================
export const claims = pgTable('claims', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
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
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('claims_edi_batch_id_idx').on(t.ediBatchId),
  index('claims_evv_visit_id_idx').on(t.evvVisitId),
  index('claims_status_idx').on(t.status),
  index('idx_claims_payer_status').on(t.payerId, t.status),
  index('idx_claims_caregiver').on(t.caregiverId),
  index('idx_claims_service_date').on(t.serviceDate),
])

// ==================== PAYMENTS ====================
export const payments = pgTable('payments', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
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
  createdBy: text('created_by').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('payments_payer_idx').on(t.payerId),
  index('payments_status_idx').on(t.reconciliationStatus),
  index('payments_date_idx').on(t.paymentDate),
])

export const paymentClaimMatches = pgTable('payment_claim_matches', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  paymentId: text('payment_id').notNull().references(() => payments.id, { onDelete: 'cascade' }),
  claimId: text('claim_id').notNull().references(() => claims.id),
  matchedAmount: decimal('matched_amount', { precision: 12, scale: 2 }).notNull(),
  matchType: text('match_type').default('auto'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('pcm_payment_idx').on(t.paymentId),
  index('pcm_claim_idx').on(t.claimId),
])

// ==================== REMITTANCE BATCHES ====================
export const remittanceBatches = pgTable('remittance_batches', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
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
  createdById: text('created_by_id').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('remittance_batches_payer_id_idx').on(t.payerId),
])

// ==================== REMITTANCE LINE ITEMS ====================
export const remittanceLineItems = pgTable('remittance_line_items', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
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
  index('remittance_line_items_batch_id_idx').on(t.batchId),
])

// ==================== GUSTO PAYROLL ====================
export const gustoSyncLog = pgTable('gusto_sync_log', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  syncType: text('sync_type').notNull(),
  status: text('status').notNull(),
  payPeriodStart: date('pay_period_start'),
  payPeriodEnd: date('pay_period_end'),
  recordsExported: integer('records_exported').default(0).notNull(),
  gustoResponse: json('gusto_response'),
  errorMessage: text('error_message'),
  createdById: text('created_by_id').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const gustoEmployeeMap = pgTable('gusto_employee_map', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  userId: text('user_id').notNull().unique().references(() => users.id, { onDelete: 'cascade' }),
  gustoEmployeeId: text('gusto_employee_id'),
  gustoUuid: text('gusto_uuid'),
  isSynced: boolean('is_synced').default(false).notNull(),
  lastSyncedAt: timestamp('last_synced_at'),
})

// ==================== EXPENSES ====================
export const expenses = pgTable('expenses', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  category: text('category'),
  description: text('description').notNull(),
  amount: decimal('amount', { precision: 10, scale: 2 }).notNull(),
  date: date('date').notNull(),
  receiptUrl: text('receipt_url'),
  status: text('status').default('pending').notNull(),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('expenses_user_id_idx').on(t.userId),
])

// ==================== PERFORMANCE RATINGS ====================
export const performanceRatings = pgTable('performance_ratings', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  caregiverId: text('caregiver_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
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
  index('performance_ratings_caregiver_id_idx').on(t.caregiverId),
  index('performance_ratings_client_id_idx').on(t.clientId),
])

// ==================== BACKGROUND CHECKS ====================
export const backgroundChecks = pgTable('background_checks', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  caregiverId: text('caregiver_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
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
  notes: text('notes'),
  createdById: text('created_by_id').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('background_checks_caregiver_id_idx').on(t.caregiverId),
])

// ==================== NOTIFICATIONS ====================
export const notifications = pgTable('notifications', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: text('type'),
  title: text('title').notNull(),
  message: text('message'),
  isRead: boolean('is_read').default(false).notNull(),
  emailSent: boolean('email_sent').default(false).notNull(),
  pushSent: boolean('push_sent').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('notifications_user_id_idx').on(t.userId),
  index('notifications_is_read_idx').on(t.isRead),
])

// ==================== NOTIFICATION PREFERENCES ====================
export const notificationPreferences = pgTable('notification_preferences', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  userId: text('user_id').notNull().unique().references(() => users.id, { onDelete: 'cascade' }),
  emailEnabled: boolean('email_enabled').default(true).notNull(),
  pushEnabled: boolean('push_enabled').default(true).notNull(),
  scheduleAlerts: boolean('schedule_alerts').default(true).notNull(),
  absenceAlerts: boolean('absence_alerts').default(true).notNull(),
  billingAlerts: boolean('billing_alerts').default(true).notNull(),
  ratingAlerts: boolean('rating_alerts').default(true).notNull(),
  dailyDigest: boolean('daily_digest').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// ==================== PUSH SUBSCRIPTIONS ====================
export const pushSubscriptions = pgTable('push_subscriptions', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  subscription: json('subscription').notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('push_subscriptions_is_active_idx').on(t.isActive),
])

// ==================== MESSAGE BOARD ====================
export const messageThreads = pgTable('message_threads', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  subject: text('subject').notNull(),
  createdById: text('created_by_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  threadType: text('thread_type').default('direct').notNull(),
  isBroadcast: boolean('is_broadcast').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('message_threads_updated_at_idx').on(t.updatedAt),
])

export const messageThreadParticipants = pgTable('message_thread_participants', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  threadId: text('thread_id').notNull().references(() => messageThreads.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  lastReadAt: timestamp('last_read_at'),
  joinedAt: timestamp('joined_at').defaultNow().notNull(),
}, (t) => [
  uniqueIndex('message_thread_participants_thread_user_idx').on(t.threadId, t.userId),
  index('message_thread_participants_user_id_idx').on(t.userId),
  index('message_thread_participants_thread_id_idx').on(t.threadId),
])

export const messages = pgTable('messages', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  threadId: text('thread_id').notNull().references(() => messageThreads.id, { onDelete: 'cascade' }),
  senderId: text('sender_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  body: text('body').notNull(),
  isDeleted: boolean('is_deleted').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('messages_thread_created_idx').on(t.threadId, t.createdAt),
])

// ==================== COMMUNICATION LOG ====================
export const communicationLog = pgTable('communication_log', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  logType: text('log_type').default('note').notNull(),
  direction: text('direction'),
  subject: text('subject'),
  body: text('body').notNull(),
  loggedById: text('logged_by_id').references(() => users.id),
  loggedByName: text('logged_by_name'),
  clientId: text('client_id').references(() => clients.id),
  followUpDate: date('follow_up_date'),
  followUpDone: boolean('follow_up_done').default(false).notNull(),
  isPinned: boolean('is_pinned').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('communication_log_entity_idx').on(t.entityType, t.entityId),
  index('communication_log_created_at_idx').on(t.createdAt),
])

// ==================== NO-SHOW ALERTS ====================
export const noshowAlertConfig = pgTable('noshow_alert_config', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  graceMinutes: integer('grace_minutes').default(15).notNull(),
  notifyAdmin: boolean('notify_admin').default(true).notNull(),
  notifyCaregiver: boolean('notify_caregiver').default(true).notNull(),
  notifyClientFamily: boolean('notify_client_family').default(false).notNull(),
  adminPhone: text('admin_phone'),
  adminEmail: text('admin_email'),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const noshowAlerts = pgTable('noshow_alerts', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  scheduleId: text('schedule_id').references(() => schedules.id),
  caregiverId: text('caregiver_id').references(() => users.id),
  clientId: text('client_id').references(() => clients.id),
  shiftDate: date('shift_date').notNull(),
  expectedStart: time('expected_start').notNull(),
  alertedAt: timestamp('alerted_at').defaultNow().notNull(),
  resolvedAt: timestamp('resolved_at'),
  resolvedById: text('resolved_by_id').references(() => users.id),
  resolutionNote: text('resolution_note'),
  status: text('status').default('open').notNull(),
  smsSent: boolean('sms_sent').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('noshow_alerts_status_date_idx').on(t.status, t.shiftDate),
  index('noshow_alerts_caregiver_id_idx').on(t.caregiverId),
])

// ==================== FORM BUILDER ====================
export const formTemplates = pgTable('form_templates', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  name: text('name').notNull(),
  description: text('description'),
  category: text('category').default('general').notNull(),
  fields: json('fields').default([]).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  requiresSignature: boolean('requires_signature').default(false).notNull(),
  autoAttachTo: text('auto_attach_to'),
  createdById: text('created_by_id').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('form_templates_category_active_idx').on(t.category, t.isActive),
])

export const formSubmissions = pgTable('form_submissions', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  templateId: text('template_id').references(() => formTemplates.id),
  templateName: text('template_name'),
  entityType: text('entity_type'),
  entityId: text('entity_id'),
  clientId: text('client_id').references(() => clients.id),
  submittedById: text('submitted_by_id').references(() => users.id),
  submittedByName: text('submitted_by_name'),
  data: json('data').default({}).notNull(),
  signature: text('signature'),
  signedAt: timestamp('signed_at'),
  status: text('status').default('draft').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('form_submissions_entity_idx').on(t.entityType, t.entityId),
  index('form_submissions_template_id_idx').on(t.templateId),
])

// ==================== LOGIN ACTIVITY ====================
export const loginActivity = pgTable('login_activity', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  email: text('email').notNull(),
  userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
  success: boolean('success').default(false).notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  failReason: text('fail_reason'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('login_activity_email_idx').on(t.email),
  index('login_activity_user_id_idx').on(t.userId),
  index('login_activity_created_at_idx').on(t.createdAt),
])

// ==================== AUDIT LOG ====================
export const auditLogs = pgTable('audit_logs', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  userId: text('user_id').notNull(),
  action: text('action').notNull(),
  tableName: text('table_name'),
  recordId: text('record_id'),
  oldData: json('old_data'),
  newData: json('new_data'),
  ipAddress: text('ip_address'),
  timestamp: timestamp('timestamp').defaultNow().notNull(),
}, (t) => [
  index('audit_logs_user_id_idx').on(t.userId),
  index('audit_logs_timestamp_idx').on(t.timestamp),
  index('audit_logs_table_name_idx').on(t.tableName),
])

// ==================== SERVICE LOCATIONS ====================
export const serviceLocations = pgTable('service_locations', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
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
})

// ==================== HELP ARTICLES ====================
export const helpArticles = pgTable('help_articles', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  agencyId: text('agency_id').notNull(),
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
  index('help_articles_agency_id_idx').on(t.agencyId),
  index('help_articles_category_idx').on(t.category),
])

// ==================== CLIENT PORTAL NOTIFICATIONS ====================
export const clientNotifications = pgTable('client_notifications', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  clientId: text('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
  type: text('type'),
  title: text('title').notNull(),
  message: text('message'),
  isRead: boolean('is_read').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('client_notifications_client_id_idx').on(t.clientId),
  index('client_notifications_is_read_idx').on(t.isRead),
])

// ==================== CLIENT PORTAL MESSAGES ====================
export const portalMessageThreads = pgTable('portal_message_threads', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  clientId: text('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
  subject: text('subject').notNull(),
  status: text('status').default('open').notNull(),
  lastMessageAt: timestamp('last_message_at').defaultNow().notNull(),
  clientLastReadAt: timestamp('client_last_read_at'),
  staffLastReadAt: timestamp('staff_last_read_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('portal_message_threads_client_id_idx').on(t.clientId),
  index('portal_message_threads_last_message_idx').on(t.lastMessageAt),
])

export const portalMessages = pgTable('portal_messages', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  threadId: text('thread_id').notNull().references(() => portalMessageThreads.id, { onDelete: 'cascade' }),
  senderType: text('sender_type').notNull(), // 'client' or 'staff'
  senderName: text('sender_name'),
  body: text('body').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('portal_messages_thread_created_idx').on(t.threadId, t.createdAt),
])

// ==================== DASHBOARD CACHE ====================
export const dashboardCache = pgTable('dashboard_cache', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  cacheKey: text('cache_key').notNull().unique(),
  data: json('data'),
  expiresAt: timestamp('expires_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// ==================== LEAD INBOX ====================

export const leadSource = pgTable('lead_source', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  platform: text('platform').notNull(),
  label: text('label').notNull(),
  inboundEmail: text('inbound_email'),
  webhookUrl: text('webhook_url'),
  webhookSecret: text('webhook_secret'),
  enabled: boolean('enabled').default(true).notNull(),
  config: json('config').default({}).notNull(),
  companyId: text('company_id').notNull().references(() => agencies.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('lead_source_company_id_idx').on(t.companyId),
  index('lead_source_platform_idx').on(t.platform),
])

export const lead = pgTable('lead', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  sourcePlatform: text('source_platform').notNull(),
  sourceId: text('source_id').references(() => leadSource.id, { onDelete: 'set null' }),
  homeownerName: text('homeowner_name').notNull(),
  email: text('email'),
  phone: text('phone'),
  jobType: text('job_type'),
  location: text('location'),
  budget: text('budget'),
  description: text('description'),
  status: text('status').default('new').notNull(),
  rawPayload: json('raw_payload'),
  convertedContactId: text('converted_contact_id'),
  contactedAt: timestamp('contacted_at'),
  receivedAt: timestamp('received_at').defaultNow().notNull(),
  companyId: text('company_id').notNull().references(() => agencies.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('lead_company_id_idx').on(t.companyId),
  index('lead_status_idx').on(t.status),
  index('lead_source_platform_idx2').on(t.sourcePlatform),
  index('lead_received_at_idx').on(t.receivedAt),
])

// ==================== ADL REQUIREMENTS ====================
export const adlRequirements = pgTable('adl_requirements', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  clientId: text('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
  adlCategory: text('adl_category').notNull(),
  assistanceLevel: text('assistance_level').notNull(),
  frequency: text('frequency'),
  specialInstructions: text('special_instructions'),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('adl_requirements_client_id_idx').on(t.clientId),
])

// ==================== ADL LOGS ====================
export const adlLogs = pgTable('adl_logs', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  clientId: text('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
  caregiverId: text('caregiver_id').references(() => users.id),
  adlCategory: text('adl_category').notNull(),
  status: text('status').notNull(),
  assistanceLevel: text('assistance_level'),
  performedAt: timestamp('performed_at').defaultNow().notNull(),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('adl_logs_client_id_idx').on(t.clientId),
  index('adl_logs_performed_at_idx').on(t.performedAt),
])

// ==================== JOB APPLICATIONS ====================
export const applications = pgTable('applications', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
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
  hiredUserId: text('hired_user_id').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('applications_status_idx').on(t.status),
  index('applications_created_at_idx').on(t.createdAt),
])

// ==================== ALERTS (GENERIC) ====================
export const alerts = pgTable('alerts', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  alertType: text('alert_type').notNull(),
  priority: text('priority').default('medium').notNull(),
  message: text('message').notNull(),
  status: text('status').default('active').notNull(),
  dueDate: timestamp('due_date'),
  relatedEntityType: text('related_entity_type'),
  relatedEntityId: text('related_entity_id'),
  acknowledgedAt: timestamp('acknowledged_at'),
  acknowledgedById: text('acknowledged_by_id').references(() => users.id),
  resolvedAt: timestamp('resolved_at'),
  resolvedById: text('resolved_by_id').references(() => users.id),
  resolution: text('resolution'),
  createdById: text('created_by_id').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('alerts_status_idx').on(t.status),
  index('alerts_alert_type_idx').on(t.alertType),
  index('alerts_priority_idx').on(t.priority),
])

// ==================== CARE PLANS ====================
export const carePlans = pgTable('care_plans', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  clientId: text('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
  serviceType: text('service_type'),
  frequency: text('frequency'),
  careGoals: text('care_goals'),
  specialInstructions: text('special_instructions'),
  precautions: text('precautions'),
  startDate: date('start_date'),
  endDate: date('end_date'),
  status: text('status').default('active').notNull(),
  createdById: text('created_by_id').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('care_plans_client_id_idx').on(t.clientId),
])

// ==================== CARE TYPES ====================
export const careTypes = pgTable('care_types', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  name: text('name').notNull(),
  description: text('description'),
  hourlyRate: decimal('hourly_rate', { precision: 8, scale: 2 }),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// ==================== CAREGIVER CARE TYPE RATES ====================
export const caregiverCareTypeRates = pgTable('caregiver_care_type_rates', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  caregiverId: text('caregiver_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  careTypeId: text('care_type_id').notNull().references(() => careTypes.id, { onDelete: 'cascade' }),
  hourlyRate: decimal('hourly_rate', { precision: 8, scale: 2 }),
  overtimeRate: decimal('overtime_rate', { precision: 8, scale: 2 }),
  holidayRate: decimal('holiday_rate', { precision: 8, scale: 2 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('caregiver_care_type_rates_caregiver_idx').on(t.caregiverId),
])

// ==================== CERTIFICATIONS ====================
export const certificationRecords = pgTable('certification_records', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  caregiverId: text('caregiver_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  certificationType: text('certification_type').notNull(),
  issuingBody: text('issuing_body'),
  issueDate: date('issue_date'),
  expiryDate: date('expiry_date'),
  documentUrl: text('document_url'),
  status: text('status').default('active').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('certification_records_caregiver_idx').on(t.caregiverId),
])

// ==================== INCIDENTS ====================
export const incidents = pgTable('incidents', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  clientId: text('client_id').references(() => clients.id),
  caregiverId: text('caregiver_id').references(() => users.id),
  incidentType: text('incident_type').notNull(),
  severity: text('severity').default('low').notNull(),
  date: date('date').notNull(),
  description: text('description').notNull(),
  involvedParties: text('involved_parties'),
  actionTaken: text('action_taken'),
  investigationStatus: text('investigation_status').default('open').notNull(),
  resolvedAt: timestamp('resolved_at'),
  resolvedById: text('resolved_by_id').references(() => users.id),
  reportedById: text('reported_by_id').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('incidents_status_idx').on(t.investigationStatus),
])

// ==================== MEDICATIONS ====================
export const medications = pgTable('medications', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  clientId: text('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  dosage: text('dosage'),
  frequency: text('frequency'),
  route: text('route'),
  indication: text('indication'),
  prescribedBy: text('prescribed_by'),
  startDate: date('start_date'),
  endDate: date('end_date'),
  status: text('status').default('active').notNull(),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('medications_client_idx').on(t.clientId),
])

// ==================== MEDICATION LOGS ====================
export const medicationLogs = pgTable('medication_logs', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  medicationId: text('medication_id').notNull().references(() => medications.id, { onDelete: 'cascade' }),
  clientId: text('client_id').notNull().references(() => clients.id),
  caregiverId: text('caregiver_id').references(() => users.id),
  administeredAt: timestamp('administered_at').notNull(),
  status: text('status').default('given').notNull(),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// ==================== SHIFT SWAPS ====================
export const shiftSwaps = pgTable('shift_swaps', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  scheduleId: text('schedule_id').references(() => schedules.id),
  requesterId: text('requester_id').notNull().references(() => users.id),
  targetId: text('target_id').references(() => users.id),
  clientId: text('client_id').references(() => clients.id),
  shiftDate: date('shift_date').notNull(),
  startTime: time('start_time'),
  endTime: time('end_time'),
  reason: text('reason'),
  status: text('status').default('pending').notNull(),
  reviewedById: text('reviewed_by_id').references(() => users.id),
  reviewedAt: timestamp('reviewed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('shift_swaps_status_idx').on(t.status),
])

// ==================== TRAINING RECORDS ====================
export const trainingRecords = pgTable('training_records', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  caregiverId: text('caregiver_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  trainingName: text('training_name').notNull(),
  provider: text('provider'),
  completedDate: date('completed_date'),
  expiryDate: date('expiry_date'),
  hoursCompleted: decimal('hours_completed', { precision: 5, scale: 1 }),
  certificateUrl: text('certificate_url'),
  status: text('status').default('completed').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('training_records_caregiver_idx').on(t.caregiverId),
])

// ==================== MILEAGE ====================
export const mileageEntries = pgTable('mileage_entries', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  caregiverId: text('caregiver_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
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
  index('mileage_entries_caregiver_idx').on(t.caregiverId),
])

// ==================== PROSPECT APPOINTMENTS ====================
export const prospectAppointments = pgTable('prospect_appointments', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  leadId: text('lead_id').references(() => lead.id),
  scheduledDate: date('scheduled_date').notNull(),
  scheduledTime: time('scheduled_time'),
  notes: text('notes'),
  status: text('status').default('scheduled').notNull(),
  createdById: text('created_by_id').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// ==================== CALL TRACKING ====================

export const trackingNumber = pgTable('tracking_number', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  phoneNumber: text('phone_number').notNull(),
  forwardTo: text('forward_to'),
  name: text('name'),
  source: text('source'),
  campaign: text('campaign'),
  medium: text('medium'),
  providerId: text('provider_id'),
  provider: text('provider'),
  active: boolean('active').default(true).notNull(),

  agencyId: text('agency_id').notNull().references(() => agencies.id, { onDelete: 'cascade' }),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('tracking_number_agency_id_idx').on(t.agencyId),
])

export const phoneCall = pgTable('phone_call', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  callerNumber: text('caller_number').notNull(),
  status: text('status').notNull(),
  duration: integer('duration'),
  recordingUrl: text('recording_url'),
  transcription: text('transcription'),

  trackingNumberId: text('tracking_number_id').notNull().references(() => trackingNumber.id, { onDelete: 'cascade' }),
  agencyId: text('agency_id').references(() => agencies.id),

  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('phone_call_tracking_number_id_idx').on(t.trackingNumberId),
])

export const callLog = pgTable('call_log', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  agencyId: text('agency_id').notNull().references(() => agencies.id, { onDelete: 'cascade' }),
  trackingNumberId: text('tracking_number_id').references(() => trackingNumber.id),
  clientId: text('client_id').references(() => clients.id),
  callerNumber: text('caller_number'),
  callerName: text('caller_name'),
  callerCity: text('caller_city'),
  callerState: text('caller_state'),
  source: text('source'),
  campaign: text('campaign'),
  medium: text('medium'),
  keyword: text('keyword'),
  landingPage: text('landing_page'),
  direction: text('direction').default('inbound'),
  duration: integer('duration'),
  status: text('status').default('completed').notNull(),
  startTime: timestamp('start_time'),
  endTime: timestamp('end_time'),
  recordingUrl: text('recording_url'),
  transcription: text('transcription'),
  tags: json('tags'),
  notes: text('notes'),
  firstTimeCaller: boolean('first_time_caller').default(false),
  providerId: text('provider_id'),
  isLead: boolean('is_lead').default(false),
  leadValue: decimal('lead_value', { precision: 12, scale: 2 }),
  aiSummary: text('ai_summary'),
  aiResponseSent: boolean('ai_response_sent').default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('call_log_agency_id_idx').on(t.agencyId),
  index('call_log_client_id_idx').on(t.clientId),
])

// ==================== AI RECEPTIONIST ====================

export const aiReceptionistRule = pgTable('ai_receptionist_rule', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  agencyId: text('agency_id').notNull().references(() => agencies.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  trigger: text('trigger').notNull(), // after_hours, missed_call, voicemail, new_lead, booking_request, keyword
  channel: text('channel').notNull(), // sms, email, both
  messageTemplate: text('message_template').notNull(),
  delayMinutes: integer('delay_minutes').default(0).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  keywordMatch: text('keyword_match'), // for keyword trigger
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('ai_receptionist_rule_agency_id_idx').on(t.agencyId),
])

export const aiReceptionistSettings = pgTable('ai_receptionist_settings', {
  agencyId: text('agency_id').primaryKey().references(() => agencies.id, { onDelete: 'cascade' }),
  isEnabled: boolean('is_enabled').default(false).notNull(),
  businessHoursStart: text('business_hours_start').default('09:00').notNull(),
  businessHoursEnd: text('business_hours_end').default('17:00').notNull(),
  timezone: text('timezone').default('America/Chicago').notNull(),
  greetingText: text('greeting_text'),
  forwardingNumber: text('forwarding_number'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// ==================== SERVICE PRICING ====================
export const servicePricing = pgTable('service_pricing', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
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
  index('service_pricing_service_type_idx').on(t.serviceType),
  index('service_pricing_is_active_idx').on(t.isActive),
])

// ==================== REFERRAL SOURCE RATES ====================
export const referralSourceRates = pgTable('referral_source_rates', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
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
  index('referral_source_rates_referral_source_id_idx').on(t.referralSourceId),
  index('referral_source_rates_care_type_id_idx').on(t.careTypeId),
])

// ==================== INVOICE ADJUSTMENTS ====================
export const invoiceAdjustments = pgTable('invoice_adjustments', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  invoiceId: text('invoice_id').notNull().references(() => invoices.id, { onDelete: 'cascade' }),
  adjustmentType: text('adjustment_type').notNull(),
  amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
  reason: text('reason'),
  notes: text('notes'),
  createdById: text('created_by_id').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('invoice_adjustments_invoice_id_idx').on(t.invoiceId),
])

// ==================== CLAIM STATUS HISTORY ====================
export const claimStatusHistory = pgTable('claim_status_history', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  claimId: text('claim_id').notNull().references(() => claims.id, { onDelete: 'cascade' }),
  status: text('status').notNull(),
  notes: text('notes'),
  createdBy: text('created_by').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('claim_status_history_claim_id_idx').on(t.claimId),
])

// ==================== DENIAL CODE LOOKUP ====================
export const denialCodeLookup = pgTable('denial_code_lookup', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  code: text('code').notNull().unique(),
  description: text('description').notNull(),
  category: text('category'),
  remediation: text('remediation'),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// ==================== SMS TEMPLATES ====================
export const smsTemplates = pgTable('sms_templates', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  name: text('name').notNull(),
  body: text('body').notNull(),
  category: text('category'),
  variables: json('variables').default([]).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// ==================== ROUTE OPTIMIZATION ====================
export const routePlans = pgTable('route_plans', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  caregiverId: text('caregiver_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  date: date('date').notNull(),
  totalDistanceMiles: decimal('total_distance_miles', { precision: 8, scale: 2 }),
  totalDurationMinutes: integer('total_duration_minutes'),
  optimizedAt: timestamp('optimized_at'),
  status: text('status').default('draft').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('route_plans_caregiver_date_idx').on(t.caregiverId, t.date),
])

export const routePlanStops = pgTable('route_plan_stops', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
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
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('route_plan_stops_route_plan_id_idx').on(t.routePlanId),
])

export const optimizerRuns = pgTable('optimizer_runs', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  runType: text('run_type').notNull(),
  status: text('status').default('pending').notNull(),
  inputParams: json('input_params'),
  resultSummary: json('result_summary'),
  errorMessage: text('error_message'),
  durationMs: integer('duration_ms'),
  createdById: text('created_by_id').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// ==================== CAREGIVER / SERVICE CAPABILITIES ====================
export const serviceCapabilities = pgTable('service_capabilities', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  name: text('name').notNull(),
  description: text('description'),
  category: text('category'),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const caregiverCapabilities = pgTable('caregiver_capabilities', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  caregiverId: text('caregiver_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  capabilityId: text('capability_id').notNull().references(() => serviceCapabilities.id, { onDelete: 'cascade' }),
  proficiencyLevel: text('proficiency_level').default('basic'),
  certifiedDate: date('certified_date'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  uniqueIndex('caregiver_capabilities_caregiver_capability_idx').on(t.caregiverId, t.capabilityId),
  index('caregiver_capabilities_caregiver_id_idx').on(t.caregiverId),
])

// ==================== CLIENT-CAREGIVER RESTRICTIONS ====================
export const clientCaregiverRestrictions = pgTable('client_caregiver_restrictions', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  clientId: text('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
  caregiverId: text('caregiver_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  restrictionType: text('restriction_type').default('do_not_assign').notNull(),
  reason: text('reason'),
  createdById: text('created_by_id').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  uniqueIndex('client_caregiver_restrictions_pair_idx').on(t.clientId, t.caregiverId),
  index('client_caregiver_restrictions_client_id_idx').on(t.clientId),
  index('client_caregiver_restrictions_caregiver_id_idx').on(t.caregiverId),
])

// ==================== COMPLIANCE DOCUMENTS ====================
export const complianceDocuments = pgTable('compliance_documents', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  title: text('title').notNull(),
  description: text('description'),
  category: text('category'),
  documentUrl: text('document_url'),
  requiresAcknowledgment: boolean('requires_acknowledgment').default(false).notNull(),
  effectiveDate: date('effective_date'),
  expiryDate: date('expiry_date'),
  isActive: boolean('is_active').default(true).notNull(),
  createdById: text('created_by_id').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('compliance_documents_category_idx').on(t.category),
])

export const documentAcknowledgments = pgTable('document_acknowledgments', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  documentId: text('document_id').notNull().references(() => complianceDocuments.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  acknowledgedAt: timestamp('acknowledged_at').defaultNow().notNull(),
  signatureData: text('signature_data'),
}, (t) => [
  uniqueIndex('document_acknowledgments_doc_user_idx').on(t.documentId, t.userId),
  index('document_acknowledgments_document_id_idx').on(t.documentId),
])

// ==================== APPLICATION STATUS HISTORY ====================
export const applicationStatusHistory = pgTable('application_status_history', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  applicationId: text('application_id').notNull().references(() => applications.id, { onDelete: 'cascade' }),
  status: text('status').notNull(),
  notes: text('notes'),
  changedById: text('changed_by_id').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('application_status_history_application_id_idx').on(t.applicationId),
])

// ==================== FAMILY PORTAL ====================
export const familyMembers = pgTable('family_members', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
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
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('family_members_client_id_idx').on(t.clientId),
  index('family_members_email_idx').on(t.email),
])

export const familyMessages = pgTable('family_messages', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  familyMemberId: text('family_member_id').notNull().references(() => familyMembers.id, { onDelete: 'cascade' }),
  clientId: text('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
  senderType: text('sender_type').notNull(),
  senderName: text('sender_name'),
  body: text('body').notNull(),
  isRead: boolean('is_read').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('family_messages_family_member_id_idx').on(t.familyMemberId),
  index('family_messages_client_id_idx').on(t.clientId),
])

// ==================== PAYROLL RECORDS ====================
export const payrollRecords = pgTable('payroll_records', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  caregiverId: text('caregiver_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
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
  approvedById: text('approved_by_id').references(() => users.id),
  processedAt: timestamp('processed_at'),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('payroll_records_caregiver_id_idx').on(t.caregiverId),
  index('payroll_records_period_idx').on(t.periodStart, t.periodEnd),
  uniqueIndex('payroll_records_caregiver_period_idx').on(t.caregiverId, t.periodStart, t.periodEnd),
])

export const payrollLineItems = pgTable('payroll_line_items', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
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
  index('payroll_line_items_payroll_record_id_idx').on(t.payrollRecordId),
])
