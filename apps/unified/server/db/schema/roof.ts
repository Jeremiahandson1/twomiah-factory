// Roofing add-on: crews, measurement orders, materials, job notes, insurance claims and supplements, adjusters, claim
// activity, storms and storm radar, canvassing, and the measurement providers. Column for column from
// templates/crm-roof/backend/db/schema.ts (docs/UNIFIED_ROOF_PLAN.md decision 7). A roofing job, its customer, quotes
// and invoices are the CRM's own tables (crm.ts), with roofing's columns on `job` (decision 2).
import { pgTable, text, boolean, integer, decimal, real, timestamp, json, uniqueIndex, index } from 'drizzle-orm/pg-core'
import { createId } from '@paralleldrive/cuid2'
import { company, user } from './core.ts'
import { contact, job } from './crm.ts'

export const crew = pgTable('crew', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  foremanName: text('foreman_name').notNull(),
  foremanPhone: text('foreman_phone').notNull(),
  size: integer('size').notNull(),
  isSubcontractor: boolean('is_subcontractor').default(false).notNull(),
  subcontractorCompanyName: text('subcontractor_company_name'),
  isActive: boolean('is_active').default(true).notNull(),
  // What the crew is paid per square (100 sq ft) of roof: the job's crew cost is this times the job's squares (job costing,
  // server/crm/roof/jobCosts.ts). Null: not set, so the crew's cost on a job is not known — never read as free.
  payPerSquare: decimal('pay_per_square', { precision: 10, scale: 2 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('crew_company_id_idx').on(t.companyId),
])

export const measurementReport = pgTable('measurement_report', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  jobId: text('job_id').references(() => job.id),
  address: text('address').notNull(),
  city: text('city').notNull(),
  state: text('state').notNull(),
  zip: text('zip').notNull(),
  provider: text('provider').notNull(),
  status: text('status').default('pending').notNull(),
  totalSquares: decimal('total_squares', { precision: 10, scale: 2 }),
  totalArea: decimal('total_area', { precision: 10, scale: 2 }),
  segments: json('segments'),
  imageryQuality: text('imagery_quality'),
  imageryDate: text('imagery_date'),
  pitchDegrees: json('pitch_degrees'),
  center: json('center'),
  reportUrl: text('report_url'),
  reportPdfUrl: text('report_pdf_url'),
  rawData: json('raw_data'),
  cost: decimal('cost', { precision: 10, scale: 2 }).default('9.00').notNull(),
  externalProvider: text('external_provider'),
  externalOrderId: text('external_order_id'),
  externalStatus: text('external_status'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('measurement_report_company_id_idx').on(t.companyId),
])

export const material = pgTable('material', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  jobId: text('job_id').notNull().references(() => job.id),
  supplier: text('supplier').notNull(),
  orderStatus: text('order_status').default('not_ordered').notNull(),
  orderDate: timestamp('order_date'),
  deliveryDate: timestamp('delivery_date'),
  lineItems: json('line_items').notNull(),
  totalCost: decimal('total_cost', { precision: 10, scale: 2 }),
  supplierOrderNumber: text('supplier_order_number'),
  deliveryAddress: text('delivery_address'),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('material_company_id_idx').on(t.companyId),
])

export const jobNote = pgTable('job_note', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  jobId: text('job_id').notNull().references(() => job.id),
  userId: text('user_id').notNull().references(() => user.id),
  body: text('body').notNull(),
  isInternal: boolean('is_internal').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('job_note_company_id_idx').on(t.companyId),
])

export const insuranceClaim = pgTable('insurance_claim', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  jobId: text('job_id').notNull().references(() => job.id).unique(),

  // Claim details
  claimNumber: text('claim_number').notNull(),
  insuranceCompany: text('insurance_company').notNull(),
  policyNumber: text('policy_number'),
  adjusterName: text('adjuster_name'),
  adjusterPhone: text('adjuster_phone'),
  adjusterEmail: text('adjuster_email'),
  adjusterCompany: text('adjuster_company'),
  dateOfLoss: timestamp('date_of_loss'),
  causeOfLoss: text('cause_of_loss'),

  // Financials
  deductible: decimal('deductible', { precision: 10, scale: 2 }),
  rcv: decimal('rcv', { precision: 10, scale: 2 }),
  acv: decimal('acv', { precision: 10, scale: 2 }),
  depreciationHeld: decimal('depreciation_held', { precision: 10, scale: 2 }),
  supplementAmount: decimal('supplement_amount', { precision: 10, scale: 2 }).default('0').notNull(),
  finalApprovedAmount: decimal('final_approved_amount', { precision: 10, scale: 2 }),

  // Status
  claimStatus: text('claim_status').default('filed').notNull(),

  // Dates
  claimFiledDate: timestamp('claim_filed_date'),
  adjusterInspectionDate: timestamp('adjuster_inspection_date'),
  approvalDate: timestamp('approval_date'),

  // Insurance extras (roofing depth, gap 7): the held depreciation is released when the carrier gets the certificate of
  // completion. When the reminder was made (once), when the certificate went to the carrier, what came back and when.
  depreciationRemindedAt: timestamp('depreciation_reminded_at'),
  completionCertificateSentAt: timestamp('completion_certificate_sent_at'),
  depreciationRecoveredAmount: decimal('depreciation_recovered_amount', { precision: 10, scale: 2 }),
  depreciationRecoveredAt: timestamp('depreciation_recovered_at'),

  // Xactimate
  xactimateScopeUrl: text('xactimate_scope_url'),
  xactimateExportUrl: text('xactimate_export_url'),

  // Notes
  denialReason: text('denial_reason'),
  internalNotes: text('internal_notes'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('insurance_claim_company_id_idx').on(t.companyId),
  index('insurance_claim_job_id_idx').on(t.jobId),
])

/**
 * A check from the carrier made out to the homeowner AND their mortgage company: the lender has to endorse it before it can be
 * deposited. Tracked from the day it arrives to the day it is deposited (roofing depth, gap 7). `status` is
 * received → sent_to_mortgage → endorsed → deposited, each with the day it happened.
 */
export const mortgageCheck = pgTable('mortgage_check', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  jobId: text('job_id').notNull().references(() => job.id),
  claimId: text('claim_id').notNull().references(() => insuranceClaim.id, { onDelete: 'cascade' }),
  mortgageCompany: text('mortgage_company').notNull(),
  loanNumber: text('loan_number'),
  checkNumber: text('check_number'),
  amount: decimal('amount', { precision: 10, scale: 2 }).notNull(),
  status: text('status').default('received').notNull(),
  receivedAt: timestamp('received_at'),
  sentAt: timestamp('sent_at'),
  trackingNumber: text('tracking_number'),
  endorsedAt: timestamp('endorsed_at'),
  depositedAt: timestamp('deposited_at'),
  notes: text('notes'),
  createdById: text('created_by_id').references(() => user.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('mortgage_check_company_id_idx').on(t.companyId),
  index('mortgage_check_claim_id_idx').on(t.claimId),
])

export const supplement = pgTable('supplement', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  jobId: text('job_id').notNull().references(() => job.id),
  claimId: text('claim_id').notNull().references(() => insuranceClaim.id, { onDelete: 'cascade' }),
  supplementNumber: text('supplement_number').notNull(),
  status: text('status').default('draft').notNull(),
  reason: text('reason').notNull(),
  lineItems: json('line_items').notNull(),
  totalAmount: decimal('total_amount', { precision: 10, scale: 2 }).notNull(),
  submittedAt: timestamp('submitted_at'),
  respondedAt: timestamp('responded_at'),
  approvedAmount: decimal('approved_amount', { precision: 10, scale: 2 }),
  denialReason: text('denial_reason'),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('supplement_company_id_idx').on(t.companyId),
  index('supplement_claim_id_idx').on(t.claimId),
])

export const adjusterContact = pgTable('adjuster_contact', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  phone: text('phone'),
  email: text('email'),
  adjusterCompany: text('company_name'),
  insuranceCarrier: text('insurance_carrier').notNull(),
  territory: text('territory'),
  notes: text('notes'),
  jobsWorkedTogether: integer('jobs_worked_together').default(0).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('adjuster_contact_company_id_idx').on(t.companyId),
])

export const claimActivity = pgTable('claim_activity', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  jobId: text('job_id').notNull().references(() => job.id),
  claimId: text('claim_id').notNull().references(() => insuranceClaim.id, { onDelete: 'cascade' }),
  userId: text('user_id').references(() => user.id),
  activityType: text('activity_type').notNull(),
  body: text('body').notNull(),
  metadata: json('metadata'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('claim_activity_company_id_idx').on(t.companyId),
  index('claim_activity_claim_id_idx').on(t.claimId),
])

export const stormEvent = pgTable('storm_event', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  eventDate: timestamp('event_date').notNull(),
  eventType: text('event_type').notNull(),
  affectedZipCodes: json('affected_zip_codes').default([]).notNull(),
  hailSizeInches: decimal('hail_size_inches', { precision: 4, scale: 2 }),
  windSpeedMph: integer('wind_speed_mph'),
  description: text('description'),
  leadCount: integer('lead_count').default(0).notNull(),
  status: text('status').default('detected').notNull(),
  source: text('source').default('manual').notNull(),
  /** Where the storm fell, drawn on the map (field/geo.ts StormPath: a polygon or a circle). Null: by zip only. */
  path: json('path'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('storm_event_company_id_idx').on(t.companyId),
])

export const stormLead = pgTable('storm_lead', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  stormEventId: text('storm_event_id').notNull().references(() => stormEvent.id, { onDelete: 'cascade' }),
  address: text('address'),
  city: text('city'),
  state: text('state'),
  zip: text('zip'),
  lat: decimal('lat', { precision: 10, scale: 7 }),
  lng: decimal('lng', { precision: 10, scale: 7 }),
  jobId: text('job_id').references(() => job.id),
  contactId: text('contact_id').references(() => contact.id),
  status: text('status').default('new').notNull(),
  estimatedDamage: text('estimated_damage'),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('storm_lead_company_id_idx').on(t.companyId),
  index('storm_lead_event_id_idx').on(t.stormEventId),
])

export const providerIntegration = pgTable('provider_integration', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),
  clientId: text('client_id'),
  clientSecret: text('client_secret'),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  tokenExpiresAt: timestamp('token_expires_at'),
  realmId: text('realm_id'),
  webhookSecret: text('webhook_secret'),
  connected: boolean('connected').default(false).notNull(),
  lastSyncedAt: timestamp('last_synced_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('provider_integration_company_id_idx').on(t.companyId),
  uniqueIndex('provider_integration_company_provider_uniq').on(t.companyId, t.provider),
])

export const canvassingSession = pgTable('canvassing_session', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => user.id),
  name: text('name').notNull(),
  status: text('status').default('active').notNull(),
  centerLat: decimal('center_lat', { precision: 10, scale: 7 }),
  centerLng: decimal('center_lng', { precision: 10, scale: 7 }),
  radiusMiles: decimal('radius_miles', { precision: 5, scale: 2 }),
  weatherEvent: text('weather_event'),
  totalDoors: integer('total_doors').default(0).notNull(),
  answeredDoors: integer('answered_doors').default(0).notNull(),
  leadsCreated: integer('leads_created').default(0).notNull(),
  startedAt: timestamp('started_at'),
  endedAt: timestamp('ended_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('canvassing_session_company_id_idx').on(t.companyId),
  index('canvassing_session_user_id_idx').on(t.userId),
])

export const canvassingStop = pgTable('canvassing_stop', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  sessionId: text('session_id').notNull().references(() => canvassingSession.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => user.id),
  address: text('address'),
  city: text('city'),
  state: text('state'),
  zip: text('zip'),
  lat: decimal('lat', { precision: 10, scale: 7 }),
  lng: decimal('lng', { precision: 10, scale: 7 }),
  outcome: text('outcome').default('no_answer').notNull(),
  notes: text('notes'),
  jobId: text('job_id').references(() => job.id),
  contactId: text('contact_id').references(() => contact.id),
  doorHangerLeft: boolean('door_hanger_left').default(false).notNull(),
  followUpDate: timestamp('follow_up_date'),
  photos: json('photos').default([]).notNull(),
  visitedAt: timestamp('visited_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('canvassing_stop_company_id_idx').on(t.companyId),
  index('canvassing_stop_session_id_idx').on(t.sessionId),
])

/**
 * A canvass territory: an area of the map a rep is sent to knock. Drawn (`boundary`: a polygon or a circle, field/geo.ts)
 * and/or a list of five-digit zips; it may be drawn around a storm (`stormEventId`). Reps are on it through
 * canvass_territory_rep.
 */
export const canvassTerritory = pgTable('canvass_territory', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  color: text('color').default('#2563eb').notNull(),
  boundary: json('boundary'),
  zips: json('zips').default([]).notNull(),
  stormEventId: text('storm_event_id').references(() => stormEvent.id, { onDelete: 'set null' }),
  notes: text('notes'),
  createdById: text('created_by_id').references(() => user.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('canvass_territory_company_id_idx').on(t.companyId),
])

/** A rep on a territory (one row each). */
export const canvassTerritoryRep = pgTable('canvass_territory_rep', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  territoryId: text('territory_id').notNull().references(() => canvassTerritory.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('canvass_territory_rep_company_id_idx').on(t.companyId),
  uniqueIndex('canvass_territory_rep_territory_user_uniq').on(t.territoryId, t.userId),
  index('canvass_territory_rep_user_id_idx').on(t.userId),
])

export const canvassingScript = pgTable('canvassing_script', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  isDefault: boolean('is_default').default(false).notNull(),
  steps: json('steps').default([]).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('canvassing_script_company_id_idx').on(t.companyId),
])

export const stormRadarEvent = pgTable('storm_radar_event', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  provider: text('provider').default('noaa').notNull(), // noaa, tomorrow_io, accuweather
  providerEventId: text('provider_event_id'),
  eventType: text('event_type').notNull(), // hail, wind, tornado, severe_thunderstorm, other
  severity: text('severity'), // minor, moderate, severe, extreme
  hailSizeInches: decimal('hail_size_inches', { precision: 4, scale: 2 }),
  windSpeedMph: integer('wind_speed_mph'),
  description: text('description'),
  lat: real('lat'),
  lng: real('lng'),
  radiusMiles: decimal('radius_miles', { precision: 6, scale: 2 }),
  state: text('state'),
  city: text('city'),
  zip: text('zip'),
  startedAt: timestamp('started_at').notNull(),
  endedAt: timestamp('ended_at'),
  rawPayload: json('raw_payload'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('storm_radar_event_company_id_idx').on(t.companyId),
  index('storm_radar_event_state_idx').on(t.state),
  index('storm_radar_event_zip_idx').on(t.zip),
  index('storm_radar_event_started_at_idx').on(t.startedAt),
])

export const stormRadarEventMatch = pgTable('storm_event_match', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  stormRadarEventId: text('storm_radar_event_id').notNull().references(() => stormRadarEvent.id, { onDelete: 'cascade' }),
  contactId: text('contact_id').notNull(),
  distanceMiles: decimal('distance_miles', { precision: 6, scale: 2 }),
  status: text('status').default('new').notNull(), // new, contacted, quoted, booked, not_interested
  contactedAt: timestamp('contacted_at'),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('storm_event_match_company_id_idx').on(t.companyId),
  index('storm_event_match_storm_radar_event_id_idx').on(t.stormRadarEventId),
  index('storm_event_match_status_idx').on(t.status),
])

/**
 * A work order: the job a crew or subcontractor is asked to do — scope, address, start date, the material list and some of
 * the job's photos — texted to them as a private link (public_token, 64 hex characters) they accept, reject or complete
 * from with no sign-in (server/crm/roof/workOrders). `material_lines` carry NO prices: a sub never sees what the roofer
 * pays. `photo_ids` are the job photos shared with the crew; `completion_photo_ids` the ones the crew took, which are also
 * the job's own photos. The link stops answering at `token_expires_at`.
 */
export const workOrder = pgTable('work_order', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  jobId: text('job_id').notNull().references(() => job.id, { onDelete: 'cascade' }),
  crewId: text('crew_id').references(() => crew.id, { onDelete: 'set null' }),
  title: text('title').notNull(),
  scope: text('scope'),
  address: text('address'),
  startDate: timestamp('start_date'),
  recipientName: text('recipient_name').notNull(),
  recipientPhone: text('recipient_phone').notNull(),
  materialLines: json('material_lines').default([]).notNull(),
  photoIds: json('photo_ids').default([]).notNull(),
  // draft → sent → accepted | rejected → completed; cancelled by the office from any stage short of completed.
  status: text('status').default('draft').notNull(),
  publicToken: text('public_token'),
  tokenExpiresAt: timestamp('token_expires_at'),
  sentAt: timestamp('sent_at'),
  respondedAt: timestamp('responded_at'),
  respondedByName: text('responded_by_name'),
  rejectReason: text('reject_reason'),
  completedAt: timestamp('completed_at'),
  completionNote: text('completion_note'),
  completionPhotoIds: json('completion_photo_ids').default([]).notNull(),
  createdById: text('created_by_id').references(() => user.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('work_order_company_id_idx').on(t.companyId),
  index('work_order_job_id_idx').on(t.jobId),
  uniqueIndex('work_order_public_token_uniq').on(t.publicToken),
])

/**
 * How a roofing company names its pipeline (roofing depth, gap 8): one row per company. `config` holds DISPLAY NAMES only —
 * `{ stageLabels: { invoiced: 'Billed' }, boards: { retail: { name, stageLabels }, insurance: { name, stageLabels } } }` — over
 * the same stage keys every job is stored with, so the stage texts, the review request and "paid → Collected" never read it
 * (server/crm/roof/pipeline.ts). No row, or an empty config, is today's names.
 */
export const roofPipelineConfig = pgTable('roof_pipeline_config', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  config: json('config').default({}).notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  uniqueIndex('roof_pipeline_config_company_id_idx').on(t.companyId),
])

/**
 * A roofing company's money rules, one row per company (roofing parity, rows 1-5; docs/parity/roof-commissions-costing.md): the
 * floor under which no commission plan pays (min_profit_kind 'percent' of the contract, or 'amount' in dollars — both null: no
 * floor). The commission disclaimer, who sees commissions and the worksheet approval switch join it as those rows land. Changed only
 * through /api/roof-money/settings (commissions:update), never through the general company settings.
 */
export const roofMoneySetting = pgTable('roof_money_setting', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  minProfitKind: text('min_profit_kind'),
  minProfitValue: decimal('min_profit_value', { precision: 12, scale: 2 }),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  uniqueIndex('roof_money_setting_company_id_idx').on(t.companyId),
])

// A job's inspection report (docs/parity/roof-inspection-report.md): a branded write-up built from the job's photos, in
// roof sections, that the roofer shares as a private link (public_token, the same kind a quote's link is) and a PDF.
// `sections` is [{ title, notes, photoIds[] }]; the photos themselves are the job's (job_photo), read when the report is
// opened, so a caption fixed later shows. public_token is empty while the link is off.
export const inspectionReport = pgTable('inspection_report', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  jobId: text('job_id').notNull().references(() => job.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  intro: text('intro'),
  sections: json('sections').default([]).notNull(),
  publicToken: text('public_token').unique(),
  linkExpiresAt: timestamp('link_expires_at'),
  // Listed in the homeowner's portal under Photos & documents (the portal opens it by their own login link, not this one).
  sharedWithCustomer: boolean('shared_with_customer').default(false).notNull(),
  createdById: text('created_by_id').references(() => user.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('inspection_report_company_id_idx').on(t.companyId),
  index('inspection_report_job_id_idx').on(t.jobId),
])
