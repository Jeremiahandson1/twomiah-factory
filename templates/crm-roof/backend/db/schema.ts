import { pgTable, text, boolean, integer, decimal, timestamp, json, uniqueIndex, index } from 'drizzle-orm/pg-core'
import { createId } from '@paralleldrive/cuid2'

// ==================== MULTI-TENANT ====================

export const company = pgTable('company', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  email: text('email'),
  phone: text('phone'),
  address: text('address'),
  city: text('city'),
  state: text('state'),
  zip: text('zip'),
  primaryColor: text('primary_color').default('{{PRIMARY_COLOR}}').notNull(),
  enabledFeatures: json('enabled_features').default([]).notNull(),
  settings: json('settings').default({}).notNull(),
  integrations: json('integrations').default({}).notNull(),

  // Measurement credits
  reportCredits: integer('report_credits').default(3).notNull(),
  reportPricePerReport: decimal('report_price_per_report', { precision: 10, scale: 2 }).default('9.00').notNull(),

  // Instant Estimator
  estimatorEnabled: boolean('estimator_enabled').default(false).notNull(),
  pricePerSquareLow: decimal('price_per_square_low', { precision: 10, scale: 2 }).default('350.00').notNull(),
  pricePerSquareHigh: decimal('price_per_square_high', { precision: 10, scale: 2 }).default('550.00').notNull(),
  estimatorHeadline: text('estimator_headline').default('Get Your Free Roof Estimate').notNull(),
  estimatorDisclaimer: text('estimator_disclaimer').default('This is an automated estimate based on satellite data. Final pricing may vary after on-site inspection.').notNull(),

  // Stripe
  stripeCustomerId: text('stripe_customer_id').unique(),

  // Twilio
  twilioPhoneNumber: text('twilio_phone_number'),
  twilioAccountSid: text('twilio_account_sid'),
  twilioAuthToken: text('twilio_auth_token'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// ==================== USERS ====================

export const user = pgTable('user', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  email: text('email').notNull(),
  passwordHash: text('password_hash').notNull(),
  firstName: text('first_name').notNull(),
  lastName: text('last_name').notNull(),
  phone: text('phone'),
  role: text('role').default('user').notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  lastLogin: timestamp('last_login'),
  refreshToken: text('refresh_token'),
  resetToken: text('reset_token'),
  resetTokenExp: timestamp('reset_token_exp'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),

  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
}, (t) => [
  uniqueIndex('user_email_company_id_key').on(t.email, t.companyId),
  index('user_company_id_idx').on(t.companyId),
])

// ==================== CRM ====================

export const contact = pgTable('contact', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  firstName: text('first_name').notNull(),
  lastName: text('last_name').notNull(),
  email: text('email'),
  phone: text('phone'),
  mobilePhone: text('mobile_phone'),
  address: text('address'),
  city: text('city'),
  state: text('state'),
  zip: text('zip'),
  leadSource: text('lead_source'),
  propertyType: text('property_type'),
  optedOutSms: boolean('opted_out_sms').default(false).notNull(),
  qbCustomerId: text('qb_customer_id'),
  portalEnabled: boolean('portal_enabled').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('contact_company_id_idx').on(t.companyId),
])

// ==================== CREWS ====================

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
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('crew_company_id_idx').on(t.companyId),
])

// ==================== JOBS ====================

export const job = pgTable('job', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  contactId: text('contact_id').notNull().references(() => contact.id),
  assignedSalesRepId: text('assigned_sales_rep_id').references(() => user.id),
  assignedCrewId: text('assigned_crew_id').references(() => crew.id),
  jobNumber: text('job_number').notNull(),
  jobType: text('job_type').notNull(),
  status: text('status').default('lead').notNull(),
  propertyAddress: text('property_address').notNull(),
  city: text('city').notNull(),
  state: text('state').notNull(),
  zip: text('zip').notNull(),

  // Roof details
  roofAge: integer('roof_age'),
  roofType: text('roof_type'),
  stories: integer('stories'),

  // Insurance
  claimNumber: text('claim_number'),
  insuranceCompany: text('insurance_company'),
  adjusterName: text('adjuster_name'),
  adjusterPhone: text('adjuster_phone'),
  dateOfLoss: timestamp('date_of_loss'),
  deductible: decimal('deductible', { precision: 10, scale: 2 }),
  rcv: decimal('rcv', { precision: 10, scale: 2 }),
  acv: decimal('acv', { precision: 10, scale: 2 }),
  approvedScope: text('approved_scope'),

  // Financials
  estimatedRevenue: decimal('estimated_revenue', { precision: 10, scale: 2 }),
  finalRevenue: decimal('final_revenue', { precision: 10, scale: 2 }),
  materialCost: decimal('material_cost', { precision: 10, scale: 2 }),
  laborCost: decimal('labor_cost', { precision: 10, scale: 2 }),

  // Scheduling
  inspectionDate: timestamp('inspection_date'),
  inspectionNotes: text('inspection_notes'),
  installDate: timestamp('install_date'),
  installEndDate: timestamp('install_end_date'),

  // Measurement
  measurementReportId: text('measurement_report_id'),
  totalSquares: decimal('total_squares', { precision: 10, scale: 2 }),

  source: text('source').notNull(),
  priority: text('priority').default('medium').notNull(),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('job_company_id_idx').on(t.companyId),
  index('job_status_idx').on(t.status),
  index('job_contact_id_idx').on(t.contactId),
])

// ==================== MEASUREMENT REPORTS ====================

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
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('measurement_report_company_id_idx').on(t.companyId),
])

// ==================== MATERIALS ====================

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

// ==================== QUOTES ====================

export const quote = pgTable('quote', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  contactId: text('contact_id').notNull().references(() => contact.id),
  jobId: text('job_id').references(() => job.id),
  quoteNumber: text('quote_number').notNull(),
  status: text('status').default('draft').notNull(),
  lineItems: json('line_items').notNull(),
  subtotal: decimal('subtotal', { precision: 10, scale: 2 }).notNull(),
  taxRate: decimal('tax_rate', { precision: 5, scale: 4 }).notNull(),
  taxAmount: decimal('tax_amount', { precision: 10, scale: 2 }).notNull(),
  total: decimal('total', { precision: 10, scale: 2 }).notNull(),
  notes: text('notes'),
  customerMessage: text('customer_message'),
  expiresAt: timestamp('expires_at').notNull(),
  approvedAt: timestamp('approved_at'),
  declinedAt: timestamp('declined_at'),
  convertedToJobId: text('converted_to_job_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('quote_company_id_idx').on(t.companyId),
  index('quote_status_idx').on(t.status),
])

// ==================== INVOICES ====================

export const invoice = pgTable('invoice', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  jobId: text('job_id').notNull().references(() => job.id),
  contactId: text('contact_id').notNull().references(() => contact.id),
  invoiceNumber: text('invoice_number').notNull(),
  status: text('status').default('draft').notNull(),
  lineItems: json('line_items').notNull(),
  subtotal: decimal('subtotal', { precision: 10, scale: 2 }).notNull(),
  taxRate: decimal('tax_rate', { precision: 5, scale: 4 }).notNull(),
  taxAmount: decimal('tax_amount', { precision: 10, scale: 2 }).notNull(),
  total: decimal('total', { precision: 10, scale: 2 }).notNull(),
  amountPaid: decimal('amount_paid', { precision: 10, scale: 2 }).default('0').notNull(),
  balance: decimal('balance', { precision: 10, scale: 2 }).notNull(),
  dueDate: timestamp('due_date'),
  paidAt: timestamp('paid_at'),
  qbInvoiceId: text('qb_invoice_id'),
  syncedAt: timestamp('synced_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('invoice_company_id_idx').on(t.companyId),
  index('invoice_status_idx').on(t.status),
])

// ==================== JOB PHOTOS ====================

export const jobPhoto = pgTable('job_photo', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  jobId: text('job_id').notNull().references(() => job.id),
  uploadedBy: text('uploaded_by').notNull().references(() => user.id),
  photoType: text('photo_type').notNull(),
  url: text('url').notNull(),
  thumbnailUrl: text('thumbnail_url'),
  caption: text('caption'),
  takenAt: timestamp('taken_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('job_photo_company_id_idx').on(t.companyId),
])

// ==================== JOB NOTES ====================

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

// ==================== SMS ====================

export const smsMessage = pgTable('sms_message', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  contactId: text('contact_id').notNull().references(() => contact.id),
  jobId: text('job_id').references(() => job.id),
  direction: text('direction').notNull(),
  body: text('body').notNull(),
  fromNumber: text('from_number').notNull(),
  toNumber: text('to_number').notNull(),
  twilioSid: text('twilio_sid'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('sms_message_company_id_idx').on(t.companyId),
])

// ==================== INSURANCE CLAIMS ====================

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

// ==================== SUPPLEMENTS ====================

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

// ==================== ADJUSTER CONTACTS ====================

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

// ==================== CLAIM ACTIVITY ====================

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

// ==================== PORTAL ====================

export const portalSession = pgTable('portal_session', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  contactId: text('contact_id').notNull().references(() => contact.id),
  companyId: text('company_id').notNull(),
  token: text('token').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('portal_session_company_id_idx').on(t.companyId),
])
