import { pgTable, text, boolean, integer, decimal, real, timestamp, date, time, json, uniqueIndex, index } from 'drizzle-orm/pg-core'
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
  logo: text('logo'),
  primaryColor: text('primary_color').default('{{PRIMARY_COLOR}}').notNull(),
  secondaryColor: text('secondary_color'),
  website: text('website'),
  licenseNumber: text('license_number'),
  enabledFeatures: json('enabled_features').default([]).notNull(),
  settings: json('settings').default({}).notNull(),
  integrations: json('integrations').default({}).notNull(),

  // Stripe
  stripeCustomerId: text('stripe_customer_id').unique(),
  subscriptionTier: text('subscription_tier'),
  licenseType: text('license_type'),
  lifetimeAccess: boolean('lifetime_access').default(false).notNull(),

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
  avatar: text('avatar'),
  role: text('role').default('user').notNull(),
  hourlyRate: decimal('hourly_rate', { precision: 10, scale: 2 }),
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
  type: text('type').default('lead').notNull(),
  name: text('name').notNull(),
  company: text('company'),
  email: text('email'),
  phone: text('phone'),
  mobile: text('mobile'),
  address: text('address'),
  city: text('city'),
  state: text('state'),
  zip: text('zip'),
  lat: real('lat'),
  lng: real('lng'),
  notes: text('notes'),
  source: text('source'),
  tags: json('tags').default([]).notNull(),
  customFields: json('custom_fields').default({}).notNull(),
  portalEnabled: boolean('portal_enabled').default(false).notNull(),
  portalToken: text('portal_token'),
  portalTokenExp: timestamp('portal_token_exp'),
  lastPortalVisit: timestamp('last_portal_visit'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),

  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
}, (t) => [
  index('contact_company_id_idx').on(t.companyId),
  index('contact_type_idx').on(t.type),
])

// ==================== PROJECTS ====================

export const project = pgTable('project', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  number: text('number').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  status: text('status').default('planning').notNull(),
  type: text('type'),
  address: text('address'),
  city: text('city'),
  state: text('state'),
  zip: text('zip'),
  lat: real('lat'),
  lng: real('lng'),
  startDate: timestamp('start_date'),
  endDate: timestamp('end_date'),
  estimatedValue: decimal('estimated_value', { precision: 12, scale: 2 }),
  actualValue: decimal('actual_value', { precision: 12, scale: 2 }),
  budget: decimal('budget', { precision: 12, scale: 2 }),
  progress: integer('progress').default(0).notNull(),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),

  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  contactId: text('contact_id').references(() => contact.id, { onDelete: 'set null' }),
}, (t) => [
  index('project_company_id_idx').on(t.companyId),
  index('project_status_idx').on(t.status),
])

// ==================== JOBS ====================

export const job = pgTable('job', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  number: text('number').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  status: text('status').default('scheduled').notNull(),
  priority: text('priority').default('normal').notNull(), // low, normal, high, emergency
  jobType: text('job_type').default('repair').notNull(), // install, repair, maintenance, emergency
  type: text('type'),
  source: text('source'),
  scheduledDate: timestamp('scheduled_date'),
  scheduledEndDate: timestamp('scheduled_end_date'),
  scheduledTime: text('scheduled_time'),
  estimatedHours: decimal('estimated_hours', { precision: 5, scale: 2 }),
  estimatedValue: decimal('estimated_value', { precision: 12, scale: 2 }),
  actualHours: decimal('actual_hours', { precision: 5, scale: 2 }),
  address: text('address'),
  city: text('city'),
  state: text('state'),
  zip: text('zip'),
  lat: real('lat'),
  lng: real('lng'),
  geofenceRadius: integer('geofence_radius').default(100),
  notes: text('notes'),
  internalNotes: text('internal_notes'),
  completedAt: timestamp('completed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),

  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  projectId: text('project_id').references(() => project.id, { onDelete: 'set null' }),
  contactId: text('contact_id').references(() => contact.id, { onDelete: 'set null' }),
  assignedToId: text('assigned_to_id').references(() => user.id, { onDelete: 'set null' }),
  createdById: text('created_by_id').references(() => user.id, { onDelete: 'set null' }),
  quoteId: text('quote_id').references(() => quote.id, { onDelete: 'set null' }),
  equipmentId: text('equipment_id').references(() => equipment.id, { onDelete: 'set null' }),
}, (t) => [
  index('job_company_id_idx').on(t.companyId),
  index('job_status_idx').on(t.status),
  index('job_scheduled_date_idx').on(t.scheduledDate),
  index('job_assigned_to_id_idx').on(t.assignedToId),
  index('job_equipment_id_idx').on(t.equipmentId),
])

// ==================== QUOTES ====================

export const quote = pgTable('quote', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  number: text('number').notNull(),
  name: text('name').notNull(),
  status: text('status').default('draft').notNull(),
  issueDate: timestamp('issue_date').defaultNow().notNull(),
  expiryDate: timestamp('expiry_date'),
  subtotal: decimal('subtotal', { precision: 12, scale: 2 }).default('0').notNull(),
  taxRate: decimal('tax_rate', { precision: 5, scale: 2 }).default('0').notNull(),
  taxAmount: decimal('tax_amount', { precision: 12, scale: 2 }).default('0').notNull(),
  discount: decimal('discount', { precision: 12, scale: 2 }).default('0').notNull(),
  total: decimal('total', { precision: 12, scale: 2 }).default('0').notNull(),
  notes: text('notes'),
  terms: text('terms'),
  sentAt: timestamp('sent_at'),
  viewedAt: timestamp('viewed_at'),
  approvedAt: timestamp('approved_at'),
  signature: text('signature'),
  signedAt: timestamp('signed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),

  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  contactId: text('contact_id').references(() => contact.id, { onDelete: 'set null' }),
  projectId: text('project_id').references(() => project.id, { onDelete: 'set null' }),
}, (t) => [
  index('quote_company_id_idx').on(t.companyId),
  index('quote_status_idx').on(t.status),
])

export const quoteLineItem = pgTable('quote_line_item', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  description: text('description').notNull(),
  type: text('type'),
  quantity: decimal('quantity', { precision: 10, scale: 2 }).default('1').notNull(),
  unitPrice: decimal('unit_price', { precision: 12, scale: 2 }).default('0').notNull(),
  total: decimal('total', { precision: 12, scale: 2 }).default('0').notNull(),
  sortOrder: integer('sort_order').default(0).notNull(),

  quoteId: text('quote_id').notNull().references(() => quote.id, { onDelete: 'cascade' }),
}, (t) => [
  index('quote_line_item_quote_id_idx').on(t.quoteId),
])

// ==================== INVOICES ====================

export const invoice = pgTable('invoice', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  number: text('number').notNull(),
  status: text('status').default('draft').notNull(),
  issueDate: timestamp('issue_date').defaultNow().notNull(),
  dueDate: timestamp('due_date'),
  subtotal: decimal('subtotal', { precision: 12, scale: 2 }).default('0').notNull(),
  taxRate: decimal('tax_rate', { precision: 5, scale: 2 }).default('0').notNull(),
  taxAmount: decimal('tax_amount', { precision: 12, scale: 2 }).default('0').notNull(),
  discount: decimal('discount', { precision: 12, scale: 2 }).default('0').notNull(),
  total: decimal('total', { precision: 12, scale: 2 }).default('0').notNull(),
  amountPaid: decimal('amount_paid', { precision: 12, scale: 2 }).default('0').notNull(),
  notes: text('notes'),
  terms: text('terms'),
  sentAt: timestamp('sent_at'),
  paidAt: timestamp('paid_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),

  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  contactId: text('contact_id').references(() => contact.id, { onDelete: 'set null' }),
  projectId: text('project_id').references(() => project.id, { onDelete: 'set null' }),
  quoteId: text('quote_id').unique().references(() => quote.id, { onDelete: 'set null' }),
}, (t) => [
  index('invoice_company_id_idx').on(t.companyId),
  index('invoice_status_idx').on(t.status),
])

export const invoiceLineItem = pgTable('invoice_line_item', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  description: text('description').notNull(),
  type: text('type'),
  quantity: decimal('quantity', { precision: 10, scale: 2 }).default('1').notNull(),
  unitPrice: decimal('unit_price', { precision: 12, scale: 2 }).default('0').notNull(),
  total: decimal('total', { precision: 12, scale: 2 }).default('0').notNull(),
  sortOrder: integer('sort_order').default(0).notNull(),

  invoiceId: text('invoice_id').notNull().references(() => invoice.id, { onDelete: 'cascade' }),
}, (t) => [
  index('invoice_line_item_invoice_id_idx').on(t.invoiceId),
])

export const payment = pgTable('payment', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
  method: text('method').default('other').notNull(),
  reference: text('reference'),
  notes: text('notes'),
  paidAt: timestamp('paid_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),

  invoiceId: text('invoice_id').notNull().references(() => invoice.id, { onDelete: 'cascade' }),
}, (t) => [
  index('payment_invoice_id_idx').on(t.invoiceId),
])

// ==================== TIME & EXPENSES ====================

export const timeEntry = pgTable('time_entry', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  date: timestamp('date').defaultNow().notNull(),
  hours: decimal('hours', { precision: 5, scale: 2 }).notNull(),
  hourlyRate: decimal('hourly_rate', { precision: 10, scale: 2 }),
  description: text('description'),
  billable: boolean('billable').default(true).notNull(),
  approved: boolean('approved').default(false).notNull(),
  approvedAt: timestamp('approved_at'),
  isAutoClocked: boolean('is_auto_clocked').default(false).notNull(),
  clockIn: timestamp('clock_in'),
  clockOut: timestamp('clock_out'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),

  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  jobId: text('job_id').references(() => job.id, { onDelete: 'set null' }),
  projectId: text('project_id').references(() => project.id, { onDelete: 'set null' }),
}, (t) => [
  index('time_entry_company_id_idx').on(t.companyId),
  index('time_entry_user_id_idx').on(t.userId),
  index('time_entry_job_id_idx').on(t.jobId),
  index('time_entry_date_idx').on(t.date),
])

export const expense = pgTable('expense', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  date: timestamp('date').defaultNow().notNull(),
  category: text('category').notNull(),
  vendor: text('vendor'),
  description: text('description'),
  amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
  taxAmount: decimal('tax_amount', { precision: 12, scale: 2 }).default('0').notNull(),
  receiptUrl: text('receipt_url'),
  billable: boolean('billable').default(true).notNull(),
  reimbursable: boolean('reimbursable').default(false).notNull(),
  reimbursed: boolean('reimbursed').default(false).notNull(),
  reimbursedAt: timestamp('reimbursed_at'),
  approved: boolean('approved').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),

  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  projectId: text('project_id').references(() => project.id, { onDelete: 'set null' }),
  jobId: text('job_id').references(() => job.id, { onDelete: 'set null' }),
}, (t) => [
  index('expense_company_id_idx').on(t.companyId),
  index('expense_project_id_idx').on(t.projectId),
  index('expense_job_id_idx').on(t.jobId),
])

// ==================== CONSTRUCTION ====================

export const dailyLog = pgTable('daily_log', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  date: timestamp('date').defaultNow().notNull(),
  weather: text('weather'),
  conditions: text('conditions'),
  crewSize: integer('crew_size'),
  hoursWorked: decimal('hours_worked', { precision: 10, scale: 2 }),
  workPerformed: text('work_performed'),
  materials: text('materials'),
  equipment: text('equipment'),
  delays: text('delays'),
  safetyNotes: text('safety_notes'),
  temperature: integer('temperature'),
  workCompleted: text('work_completed'),
  visitors: text('visitors'),
  photos: json('photos').default([]).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),

  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  projectId: text('project_id').notNull().references(() => project.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
}, (t) => [
  index('daily_log_company_id_idx').on(t.companyId),
  index('daily_log_project_id_idx').on(t.projectId),
  index('daily_log_date_idx').on(t.date),
])

export const rfi = pgTable('rfi', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  number: text('number').notNull(),
  subject: text('subject').notNull(),
  question: text('question').notNull(),
  status: text('status').default('open').notNull(),
  priority: text('priority').default('normal').notNull(),
  assignedTo: text('assigned_to'),
  dueDate: timestamp('due_date'),
  response: text('response'),
  respondedAt: timestamp('responded_at'),
  respondedBy: text('responded_by'),
  closedAt: timestamp('closed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),

  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  projectId: text('project_id').notNull().references(() => project.id, { onDelete: 'cascade' }),
}, (t) => [
  index('rfi_company_id_idx').on(t.companyId),
  index('rfi_project_id_idx').on(t.projectId),
])

export const submittal = pgTable('submittal', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  number: text('number').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  status: text('status').default('pending').notNull(),
  specSection: text('spec_section'),
  dueDate: timestamp('due_date'),
  submittedDate: timestamp('submitted_date'),
  approvedDate: timestamp('approved_date'),
  approvedBy: text('approved_by'),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),

  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  projectId: text('project_id').notNull().references(() => project.id, { onDelete: 'cascade' }),
}, (t) => [
  index('submittal_company_id_idx').on(t.companyId),
  index('submittal_project_id_idx').on(t.projectId),
])

export const changeOrder = pgTable('change_order', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  number: text('number').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  status: text('status').default('draft').notNull(),
  reason: text('reason'),
  amount: decimal('amount', { precision: 12, scale: 2 }).default('0').notNull(),
  daysAdded: integer('days_added').default(0).notNull(),
  submittedDate: timestamp('submitted_date'),
  approvedDate: timestamp('approved_date'),
  approvedBy: text('approved_by'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),

  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  projectId: text('project_id').notNull().references(() => project.id, { onDelete: 'cascade' }),
}, (t) => [
  index('change_order_company_id_idx').on(t.companyId),
  index('change_order_project_id_idx').on(t.projectId),
])

export const changeOrderLineItem = pgTable('change_order_line_item', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  description: text('description').notNull(),
  quantity: decimal('quantity', { precision: 10, scale: 2 }).default('1').notNull(),
  unitPrice: decimal('unit_price', { precision: 12, scale: 2 }).default('0').notNull(),
  total: decimal('total', { precision: 12, scale: 2 }).default('0').notNull(),
  sortOrder: integer('sort_order').default(0).notNull(),

  changeOrderId: text('change_order_id').notNull().references(() => changeOrder.id, { onDelete: 'cascade' }),
}, (t) => [
  index('change_order_line_item_change_order_id_idx').on(t.changeOrderId),
])

export const punchListItem = pgTable('punch_list_item', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  number: text('number').notNull(),
  description: text('description').notNull(),
  location: text('location'),
  status: text('status').default('open').notNull(),
  priority: text('priority').default('normal').notNull(),
  assignedTo: text('assigned_to'),
  dueDate: timestamp('due_date'),
  completedAt: timestamp('completed_at'),
  verifiedAt: timestamp('verified_at'),
  verifiedBy: text('verified_by'),
  photos: json('photos').default([]).notNull(),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),

  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  projectId: text('project_id').notNull().references(() => project.id, { onDelete: 'cascade' }),
}, (t) => [
  index('punch_list_item_company_id_idx').on(t.companyId),
  index('punch_list_item_project_id_idx').on(t.projectId),
  index('punch_list_item_status_idx').on(t.status),
])

export const inspection = pgTable('inspection', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  number: text('number').notNull(),
  type: text('type').notNull(),
  status: text('status').default('scheduled').notNull(),
  scheduledDate: timestamp('scheduled_date'),
  inspector: text('inspector'),
  result: text('result'),
  notes: text('notes'),
  deficiencies: text('deficiencies'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),

  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  projectId: text('project_id').notNull().references(() => project.id, { onDelete: 'cascade' }),
}, (t) => [
  index('inspection_company_id_idx').on(t.companyId),
  index('inspection_project_id_idx').on(t.projectId),
])

// ==================== BIDDING ====================

export const bid = pgTable('bid', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  number: text('number').notNull(),
  projectName: text('project_name').notNull(),
  client: text('client'),
  status: text('status').default('draft').notNull(),
  bidType: text('bid_type').default('lump_sum').notNull(),
  dueDate: timestamp('due_date'),
  dueTime: text('due_time'),
  estimatedValue: decimal('estimated_value', { precision: 12, scale: 2 }),
  bidAmount: decimal('bid_amount', { precision: 12, scale: 2 }),
  bondRequired: boolean('bond_required').default(false).notNull(),
  prebidDate: timestamp('prebid_date'),
  prebidLocation: text('prebid_location'),
  scope: text('scope'),
  notes: text('notes'),
  submittedAt: timestamp('submitted_at'),
  resultDate: timestamp('result_date'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),

  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
}, (t) => [
  index('bid_company_id_idx').on(t.companyId),
  index('bid_status_idx').on(t.status),
])

// ==================== MARKETING ====================

export const campaign = pgTable('campaign', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  name: text('name').notNull(),
  type: text('type').default('email').notNull(),
  subject: text('subject'),
  content: text('content'),
  status: text('status').default('draft').notNull(),
  scheduledDate: timestamp('scheduled_date'),
  sentAt: timestamp('sent_at'),
  recipientCount: integer('recipient_count').default(0).notNull(),
  openCount: integer('open_count').default(0).notNull(),
  clickCount: integer('click_count').default(0).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),

  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
}, (t) => [
  index('campaign_company_id_idx').on(t.companyId),
])

// ==================== COMMUNICATION ====================

export const message = pgTable('message', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  type: text('type').default('email').notNull(),
  direction: text('direction').default('outbound').notNull(),
  subject: text('subject'),
  body: text('body').notNull(),
  status: text('status').default('draft').notNull(),
  sentAt: timestamp('sent_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),

  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  contactId: text('contact_id').references(() => contact.id, { onDelete: 'set null' }),
  userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
}, (t) => [
  index('message_company_id_idx').on(t.companyId),
  index('message_contact_id_idx').on(t.contactId),
])

// ==================== DOCUMENTS ====================

export const document = pgTable('document', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  name: text('name').notNull(),
  type: text('type').default('general').notNull(),
  filename: text('filename').notNull(),
  originalName: text('original_name').notNull(),
  mimeType: text('mime_type'),
  size: integer('size'),
  path: text('path').notNull(),
  url: text('url').notNull(),
  thumbnailUrl: text('thumbnail_url'),
  description: text('description'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),

  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  projectId: text('project_id').references(() => project.id, { onDelete: 'set null' }),
  contactId: text('contact_id').references(() => contact.id, { onDelete: 'set null' }),
  jobId: text('job_id').references(() => job.id, { onDelete: 'set null' }),
  invoiceId: text('invoice_id').references(() => invoice.id, { onDelete: 'set null' }),
  uploadedById: text('uploaded_by_id').references(() => user.id, { onDelete: 'set null' }),
}, (t) => [
  index('document_company_id_idx').on(t.companyId),
  index('document_project_id_idx').on(t.projectId),
  index('document_contact_id_idx').on(t.contactId),
  index('document_type_idx').on(t.type),
])

// ==================== TEAM ====================

export const teamMember = pgTable('team_member', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  name: text('name').notNull(),
  email: text('email'),
  phone: text('phone'),
  role: text('role'),
  department: text('department'),
  hireDate: timestamp('hire_date'),
  hourlyRate: decimal('hourly_rate', { precision: 10, scale: 2 }),
  active: boolean('active').default(true).notNull(),
  skills: json('skills').default([]).notNull(),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),

  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
}, (t) => [
  index('team_member_company_id_idx').on(t.companyId),
])

// ==================== SMS ====================

export const smsConversation = pgTable('sms_conversation', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  phoneNumber: text('phone_number').notNull(),
  status: text('status').default('active').notNull(),
  unreadCount: integer('unread_count').default(0).notNull(),
  lastMessageAt: timestamp('last_message_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),

  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  contactId: text('contact_id').references(() => contact.id, { onDelete: 'set null' }),
}, (t) => [
  uniqueIndex('sms_conversation_company_id_phone_number_key').on(t.companyId, t.phoneNumber),
  index('sms_conversation_company_id_status_idx').on(t.companyId, t.status),
])

export const smsMessage = pgTable('sms_message', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  direction: text('direction').notNull(),
  body: text('body').notNull(),
  status: text('status').default('queued').notNull(),
  twilioSid: text('twilio_sid').unique(),
  errorCode: text('error_code'),
  errorMessage: text('error_message'),
  mediaUrls: json('media_urls'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  sentAt: timestamp('sent_at'),
  deliveredAt: timestamp('delivered_at'),

  conversationId: text('conversation_id').notNull().references(() => smsConversation.id, { onDelete: 'cascade' }),
  sentById: text('sent_by_id').references(() => user.id, { onDelete: 'set null' }),
}, (t) => [
  index('sms_message_conversation_id_created_at_idx').on(t.conversationId, t.createdAt),
])

export const smsTemplate = pgTable('sms_template', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  name: text('name').notNull(),
  body: text('body').notNull(),
  category: text('category'),
  active: boolean('active').default(true).notNull(),
  useCount: integer('use_count').default(0).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),

  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
}, (t) => [
  index('sms_template_company_id_category_idx').on(t.companyId, t.category),
])

export const scheduledSms = pgTable('scheduled_sms', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  to: text('to').notNull(),
  body: text('body').notNull(),
  scheduledFor: timestamp('scheduled_for').notNull(),
  status: text('status').default('pending').notNull(),
  sentAt: timestamp('sent_at'),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at').defaultNow().notNull(),

  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  contactId: text('contact_id').references(() => contact.id, { onDelete: 'set null' }),
  jobId: text('job_id').references(() => job.id, { onDelete: 'set null' }),
  createdById: text('created_by_id').references(() => user.id, { onDelete: 'set null' }),
}, (t) => [
  index('scheduled_sms_company_id_scheduled_for_status_idx').on(t.companyId, t.scheduledFor, t.status),
])

export const emailLog = pgTable('email_log', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  to: text('to').notNull(),
  subject: text('subject').notNull(),
  body: text('body'),
  status: text('status').default('queued').notNull(),
  sendgridId: text('sendgrid_id'),
  errorMessage: text('error_message'),
  openedAt: timestamp('opened_at'),
  clickedAt: timestamp('clicked_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  sentAt: timestamp('sent_at'),

  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  contactId: text('contact_id').references(() => contact.id, { onDelete: 'set null' }),
  sentById: text('sent_by_id').references(() => user.id, { onDelete: 'set null' }),

  invoiceId: text('invoice_id'),
  quoteId: text('quote_id'),
  jobId: text('job_id'),
}, (t) => [
  index('email_log_company_id_created_at_idx').on(t.companyId, t.createdAt),
  index('email_log_contact_id_idx').on(t.contactId),
])

// ==================== GPS/LOCATION ====================

export const locationLog = pgTable('location_log', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  lat: real('lat').notNull(),
  lng: real('lng').notNull(),
  accuracy: real('accuracy'),
  timestamp: timestamp('timestamp').defaultNow().notNull(),
  action: text('action'),

  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  jobId: text('job_id').references(() => job.id, { onDelete: 'set null' }),
}, (t) => [
  index('location_log_user_id_company_id_timestamp_idx').on(t.userId, t.companyId, t.timestamp),
  index('location_log_job_id_idx').on(t.jobId),
])

export const geofence = pgTable('geofence', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  name: text('name').notNull(),
  lat: real('lat').notNull(),
  lng: real('lng').notNull(),
  radius: integer('radius').default(100).notNull(),
  address: text('address'),
  active: boolean('active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),

  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  jobId: text('job_id').unique().references(() => job.id, { onDelete: 'set null' }),
  projectId: text('project_id').references(() => project.id, { onDelete: 'set null' }),
}, (t) => [
  index('geofence_company_id_active_idx').on(t.companyId, t.active),
])

export const geofenceEvent = pgTable('geofence_event', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  inside: boolean('inside').notNull(),
  lat: real('lat').notNull(),
  lng: real('lng').notNull(),
  accuracy: real('accuracy'),
  distance: real('distance'),
  timestamp: timestamp('timestamp').defaultNow().notNull(),

  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  geofenceId: text('geofence_id').notNull().references(() => geofence.id, { onDelete: 'cascade' }),
}, (t) => [
  index('geofence_event_user_id_geofence_id_timestamp_idx').on(t.userId, t.geofenceId, t.timestamp),
])

export const userSettings = pgTable('user_settings', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  userId: text('user_id').notNull().unique().references(() => user.id, { onDelete: 'cascade' }),

  locationTrackingEnabled: boolean('location_tracking_enabled').default(false).notNull(),
  autoClockEnabled: boolean('auto_clock_enabled').default(false).notNull(),
  backgroundTrackingEnabled: boolean('background_tracking_enabled').default(false).notNull(),
  locationAccuracy: text('location_accuracy').default('high').notNull(),
  trackingInterval: integer('tracking_interval').default(30).notNull(),
  geofenceRadius: integer('geofence_radius').default(100).notNull(),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// ==================== INVENTORY ====================

export const inventoryItem = pgTable('inventory_item', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  sku: text('sku').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  category: text('category'),

  unitCost: decimal('unit_cost', { precision: 10, scale: 2 }).default('0').notNull(),
  unitPrice: decimal('unit_price', { precision: 10, scale: 2 }).default('0').notNull(),
  unit: text('unit').default('each').notNull(),

  minStockLevel: integer('min_stock_level').default(0).notNull(),
  reorderPoint: integer('reorder_point').default(0).notNull(),
  reorderQuantity: integer('reorder_quantity').default(0).notNull(),

  vendor: text('vendor'),
  vendorPartNumber: text('vendor_part_number'),
  barcode: text('barcode'),
  imageUrl: text('image_url'),
  taxable: boolean('taxable').default(true).notNull(),
  active: boolean('active').default(true).notNull(),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),

  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
}, (t) => [
  uniqueIndex('inventory_item_company_id_sku_key').on(t.companyId, t.sku),
  index('inventory_item_company_id_category_idx').on(t.companyId, t.category),
])

export const inventoryLocation = pgTable('inventory_location', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  name: text('name').notNull(),
  type: text('type').default('warehouse').notNull(),
  address: text('address'),
  active: boolean('active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),

  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  assignedUserId: text('assigned_user_id').references(() => user.id, { onDelete: 'set null' }),
}, (t) => [
  index('inventory_location_company_id_type_idx').on(t.companyId, t.type),
])

export const stockLevel = pgTable('stock_level', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  quantity: integer('quantity').default(0).notNull(),

  itemId: text('item_id').notNull().references(() => inventoryItem.id, { onDelete: 'cascade' }),
  locationId: text('location_id').notNull().references(() => inventoryLocation.id, { onDelete: 'cascade' }),
}, (t) => [
  uniqueIndex('stock_level_item_id_location_id_key').on(t.itemId, t.locationId),
])

export const inventoryTransaction = pgTable('inventory_transaction', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  type: text('type').notNull(),
  quantity: integer('quantity').notNull(),
  previousQuantity: integer('previous_quantity').notNull(),
  newQuantity: integer('new_quantity').notNull(),
  reason: text('reason'),
  cost: decimal('cost', { precision: 10, scale: 2 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),

  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  itemId: text('item_id').notNull().references(() => inventoryItem.id, { onDelete: 'cascade' }),
  locationId: text('location_id').notNull().references(() => inventoryLocation.id, { onDelete: 'cascade' }),
  userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
  jobId: text('job_id').references(() => job.id, { onDelete: 'set null' }),
}, (t) => [
  index('inventory_transaction_company_id_created_at_idx').on(t.companyId, t.createdAt),
])

export const inventoryUsage = pgTable('inventory_usage', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  quantity: integer('quantity').notNull(),
  returnedQuantity: integer('returned_quantity').default(0).notNull(),
  unitCost: decimal('unit_cost', { precision: 10, scale: 2 }).notNull(),
  unitPrice: decimal('unit_price', { precision: 10, scale: 2 }).notNull(),
  totalCost: decimal('total_cost', { precision: 10, scale: 2 }).notNull(),
  totalPrice: decimal('total_price', { precision: 10, scale: 2 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),

  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  jobId: text('job_id').notNull().references(() => job.id, { onDelete: 'cascade' }),
  itemId: text('item_id').notNull().references(() => inventoryItem.id, { onDelete: 'cascade' }),
  locationId: text('location_id').notNull().references(() => inventoryLocation.id, { onDelete: 'cascade' }),
  userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
}, (t) => [
  index('inventory_usage_job_id_idx').on(t.jobId),
])

export const inventoryTransfer = pgTable('inventory_transfer', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  quantity: integer('quantity').notNull(),
  status: text('status').default('pending').notNull(),
  notes: text('notes'),
  completedAt: timestamp('completed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),

  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  itemId: text('item_id').notNull().references(() => inventoryItem.id, { onDelete: 'cascade' }),
  fromLocationId: text('from_location_id').notNull().references(() => inventoryLocation.id, { onDelete: 'cascade' }),
  toLocationId: text('to_location_id').notNull().references(() => inventoryLocation.id, { onDelete: 'cascade' }),
  userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
}, (t) => [
  index('inventory_transfer_company_id_status_idx').on(t.companyId, t.status),
])

export const purchaseOrder = pgTable('purchase_order', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  number: text('number').notNull(),
  vendor: text('vendor').notNull(),
  vendorEmail: text('vendor_email'),
  status: text('status').default('draft').notNull(),
  total: decimal('total', { precision: 10, scale: 2 }).default('0').notNull(),
  notes: text('notes'),
  expectedDate: timestamp('expected_date'),
  receivedAt: timestamp('received_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),

  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  locationId: text('location_id').notNull().references(() => inventoryLocation.id, { onDelete: 'cascade' }),
  createdById: text('created_by_id').references(() => user.id, { onDelete: 'set null' }),
}, (t) => [
  uniqueIndex('purchase_order_company_id_number_key').on(t.companyId, t.number),
])

export const purchaseOrderItem = pgTable('purchase_order_item', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  quantity: integer('quantity').notNull(),
  receivedQuantity: integer('received_quantity').default(0).notNull(),
  unitCost: decimal('unit_cost', { precision: 10, scale: 2 }).notNull(),
  totalCost: decimal('total_cost', { precision: 10, scale: 2 }).notNull(),

  purchaseOrderId: text('purchase_order_id').notNull().references(() => purchaseOrder.id, { onDelete: 'cascade' }),
  itemId: text('item_id').notNull().references(() => inventoryItem.id, { onDelete: 'cascade' }),
})

// ==================== PRICEBOOK ====================

export const pricebookCategory = pgTable('pricebook_category', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  name: text('name').notNull(),
  description: text('description'),
  sortOrder: integer('sort_order').default(0).notNull(),
  active: boolean('active').default(true).notNull(),

  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  parentId: text('parent_id'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('pricebook_category_company_id_idx').on(t.companyId),
])

export const pricebookItem = pgTable('pricebook_item', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  name: text('name').notNull(),
  description: text('description'),
  type: text('type').default('service').notNull(),
  code: text('code'),
  price: decimal('price', { precision: 12, scale: 2 }).notNull(),
  cost: decimal('cost', { precision: 12, scale: 2 }).default('0').notNull(),
  unit: text('unit').default('each').notNull(),
  taxable: boolean('taxable').default(true).notNull(),
  active: boolean('active').default(true).notNull(),

  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  categoryId: text('category_id').references(() => pricebookCategory.id),
  inventoryItemId: text('inventory_item_id').references(() => inventoryItem.id),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('pricebook_item_company_id_idx').on(t.companyId),
  index('pricebook_item_category_id_idx').on(t.categoryId),
])

// ==================== REVIEWS ====================

export const reviewRequest = pgTable('review_request', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  status: text('status').default('pending').notNull(),
  sentAt: timestamp('sent_at'),
  openedAt: timestamp('opened_at'),
  submittedAt: timestamp('submitted_at'),

  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  contactId: text('contact_id').notNull().references(() => contact.id, { onDelete: 'cascade' }),

  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('review_request_company_id_idx').on(t.companyId),
])

export const review = pgTable('review', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  rating: integer('rating').notNull(),
  comment: text('comment'),
  platform: text('platform').default('google').notNull(),
  externalId: text('external_id'),

  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  contactId: text('contact_id').references(() => contact.id, { onDelete: 'set null' }),
  requestId: text('request_id').unique().references(() => reviewRequest.id),

  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('review_company_id_idx').on(t.companyId),
])

// ==================== FINANCING ====================

export const financingApplication = pgTable('financing_application', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  status: text('status').default('pending').notNull(),
  amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
  term: integer('term'),
  externalId: text('external_id'),
  applicationUrl: text('application_url'),
  approvedAmount: decimal('approved_amount', { precision: 12, scale: 2 }),

  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  contactId: text('contact_id').notNull().references(() => contact.id, { onDelete: 'cascade' }),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('financing_application_company_id_idx').on(t.companyId),
])

// ==================== SERVICE AGREEMENTS ====================

export const serviceAgreement = pgTable('service_agreement', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  number: text('number').notNull(),
  name: text('name').notNull(),
  status: text('status').default('active').notNull(),
  startDate: timestamp('start_date').notNull(),
  endDate: timestamp('end_date'),
  renewalType: text('renewal_type').default('auto').notNull(),
  billingFrequency: text('billing_frequency').default('monthly').notNull(),
  amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
  terms: text('terms'),
  notes: text('notes'),

  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  contactId: text('contact_id').notNull().references(() => contact.id, { onDelete: 'cascade' }),
  planId: text('plan_id'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('service_agreement_company_id_idx').on(t.companyId),
])

export const agreementVisit = pgTable('agreement_visit', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  scheduledDate: timestamp('scheduled_date').notNull(),
  completedAt: timestamp('completed_at'),
  status: text('status').default('scheduled').notNull(),
  notes: text('notes'),

  agreementId: text('agreement_id').notNull().references(() => serviceAgreement.id, { onDelete: 'cascade' }),
}, (t) => [
  index('agreement_visit_agreement_id_idx').on(t.agreementId),
])

// ==================== EQUIPMENT ====================

export const equipmentCategory = pgTable('equipment_category', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  name: text('name').notNull(),

  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
}, (t) => [
  index('equipment_category_company_id_idx').on(t.companyId),
])

export const equipment = pgTable('equipment', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  name: text('name').notNull(),
  serialNumber: text('serial_number'),
  model: text('model'),
  manufacturer: text('manufacturer'),
  status: text('status').default('active').notNull(),
  location: text('location'),
  purchaseDate: timestamp('purchase_date'),
  warrantyExpiry: timestamp('warranty_expiry'),
  notes: text('notes'),

  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  categoryId: text('category_id').references(() => equipmentCategory.id),
  contactId: text('contact_id').references(() => contact.id, { onDelete: 'set null' }),
  locationId: text('location_id'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('equipment_company_id_idx').on(t.companyId),
  index('equipment_contact_id_idx').on(t.contactId),
])

export const equipmentMaintenance = pgTable('equipment_maintenance', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  type: text('type').notNull(),
  description: text('description'),
  cost: decimal('cost', { precision: 10, scale: 2 }),
  performedAt: timestamp('performed_at').defaultNow().notNull(),
  nextDueDate: timestamp('next_due_date'),

  equipmentId: text('equipment_id').notNull().references(() => equipment.id, { onDelete: 'cascade' }),
}, (t) => [
  index('equipment_maintenance_equipment_id_idx').on(t.equipmentId),
])

// ==================== FLEET ====================

export const vehicle = pgTable('vehicle', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  name: text('name').notNull(),
  type: text('type').default('truck').notNull(),
  make: text('make'),
  model: text('model'),
  year: integer('year'),
  vin: text('vin'),
  licensePlate: text('license_plate'),
  status: text('status').default('active').notNull(),
  color: text('color'),
  notes: text('notes'),
  assignedUserId: text('assigned_user_id').references(() => user.id),
  currentMileage: integer('current_mileage'),
  fuelType: text('fuel_type'),

  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('vehicle_company_id_idx').on(t.companyId),
  index('vehicle_assigned_user_id_idx').on(t.assignedUserId),
])

export const vehicleMaintenance = pgTable('vehicle_maintenance', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  type: text('type').notNull(),
  description: text('description'),
  cost: decimal('cost', { precision: 10, scale: 2 }),
  mileage: integer('mileage'),
  performedAt: timestamp('performed_at').defaultNow().notNull(),
  nextDueDate: timestamp('next_due_date'),
  nextDueMileage: integer('next_due_mileage'),

  vehicleId: text('vehicle_id').notNull().references(() => vehicle.id, { onDelete: 'cascade' }),
}, (t) => [
  index('vehicle_maintenance_vehicle_id_idx').on(t.vehicleId),
])

export const fuelLog = pgTable('fuel_log', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  gallons: decimal('gallons', { precision: 8, scale: 3 }).notNull(),
  pricePerGallon: decimal('price_per_gallon', { precision: 6, scale: 3 }).notNull(),
  totalCost: decimal('total_cost', { precision: 10, scale: 2 }).notNull(),
  mileage: integer('mileage'),
  station: text('station'),

  vehicleId: text('vehicle_id').notNull().references(() => vehicle.id, { onDelete: 'cascade' }),

  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('fuel_log_vehicle_id_idx').on(t.vehicleId),
])

// ==================== EMAIL MARKETING ====================

export const emailTemplate = pgTable('email_template', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  name: text('name').notNull(),
  subject: text('subject').notNull(),
  body: text('body').notNull(),
  type: text('type'),
  active: boolean('active').default(true).notNull(),

  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('email_template_company_id_idx').on(t.companyId),
])

export const emailCampaign = pgTable('email_campaign', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  name: text('name').notNull(),
  subject: text('subject').notNull(),
  body: text('body').notNull(),
  status: text('status').default('draft').notNull(),
  recipientFilter: json('recipient_filter'),
  scheduledAt: timestamp('scheduled_at'),
  sentAt: timestamp('sent_at'),
  stats: json('stats'),

  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('email_campaign_company_id_idx').on(t.companyId),
])

export const automation = pgTable('automation', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  name: text('name').notNull(),
  trigger: text('trigger').notNull(),
  conditions: json('conditions'),
  actions: json('actions').notNull(),
  active: boolean('active').default(true).notNull(),

  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('automation_company_id_idx').on(t.companyId),
])

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

  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('tracking_number_company_id_idx').on(t.companyId),
])

export const phoneCall = pgTable('phone_call', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  callerNumber: text('caller_number').notNull(),
  status: text('status').notNull(),
  duration: integer('duration'),
  recordingUrl: text('recording_url'),
  transcription: text('transcription'),

  trackingNumberId: text('tracking_number_id').notNull().references(() => trackingNumber.id, { onDelete: 'cascade' }),
  companyId: text('company_id').references(() => company.id),

  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('phone_call_tracking_number_id_idx').on(t.trackingNumberId),
])

// ==================== SCHEDULING ====================

export const scheduleEvent = pgTable('schedule_event', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  title: text('title').notNull(),
  type: text('type').default('appointment').notNull(),
  start: timestamp('start').notNull(),
  end: timestamp('end').notNull(),
  allDay: boolean('all_day').default(false).notNull(),
  status: text('status').default('scheduled').notNull(),
  notes: text('notes'),
  color: text('color'),

  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('schedule_event_company_id_start_idx').on(t.companyId, t.start),
])

export const recurringSchedule = pgTable('recurring_schedule', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  name: text('name').notNull(),
  pattern: text('pattern').notNull(),
  interval: integer('interval').default(1).notNull(),
  daysOfWeek: json('days_of_week').default([]).notNull(),
  startDate: timestamp('start_date').notNull(),
  endDate: timestamp('end_date'),

  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),

  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('recurring_schedule_company_id_idx').on(t.companyId),
])

// ==================== SELECTIONS ====================

export const selectionCategory = pgTable('selection_category', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  name: text('name').notNull(),
  description: text('description'),
  icon: text('icon'),
  defaultAllowance: decimal('default_allowance', { precision: 12, scale: 2 }).default('0'),
  sortOrder: integer('sort_order').default(0).notNull(),
  active: boolean('active').default(true).notNull(),

  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
}, (t) => [
  index('selection_category_company_id_idx').on(t.companyId),
  index('selection_category_company_id_active_idx').on(t.companyId, t.active),
  uniqueIndex('selection_category_company_id_name_idx').on(t.companyId, t.name),
])

export const selectionItem = pgTable('selection_item', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  name: text('name').notNull(),
  description: text('description'),
  price: decimal('price', { precision: 12, scale: 2 }).default('0').notNull(),
  imageUrl: text('image_url'),
  allowance: decimal('allowance', { precision: 12, scale: 2 }),
  active: boolean('active').default(true).notNull(),

  categoryId: text('category_id').notNull().references(() => selectionCategory.id, { onDelete: 'cascade' }),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
}, (t) => [
  index('selection_item_category_id_idx').on(t.categoryId),
  index('selection_item_company_id_active_idx').on(t.companyId, t.active),
])

export const selection = pgTable('selection', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  status: text('status').default('pending').notNull(),
  notes: text('notes'),
  approvedAt: timestamp('approved_at'),

  projectId: text('project_id').notNull().references(() => project.id, { onDelete: 'cascade' }),
  contactId: text('contact_id').references(() => contact.id, { onDelete: 'set null' }),
  itemId: text('item_id').notNull().references(() => selectionItem.id, { onDelete: 'cascade' }),

  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('selection_project_id_idx').on(t.projectId),
])

// ==================== TAKEOFFS ====================

export const takeoff = pgTable('takeoff', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  name: text('name').notNull(),
  status: text('status').default('draft').notNull(),

  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  projectId: text('project_id').references(() => project.id, { onDelete: 'set null' }),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('takeoff_company_id_idx').on(t.companyId),
])

export const takeoffItem = pgTable('takeoff_item', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  sheetId: text('sheet_id').references(() => takeoffSheet.id, { onDelete: 'cascade' }),
  assemblyId: text('assembly_id').references(() => takeoffAssembly.id),
  name: text('name').notNull(),
  location: text('location'),
  measurementType: text('measurement_type').default('area'),
  length: decimal('length', { precision: 12, scale: 4 }).default('0'),
  width: decimal('width', { precision: 12, scale: 4 }).default('0'),
  height: decimal('height', { precision: 12, scale: 4 }).default('0'),
  quantity: decimal('quantity', { precision: 12, scale: 4 }).default('1').notNull(),
  measurementValue: decimal('measurement_value', { precision: 12, scale: 4 }).default('0'),
  wasteFactor: decimal('waste_factor', { precision: 5, scale: 2 }).default('10'),
  notes: text('notes'),
  sortOrder: integer('sort_order').default(0),
  description: text('description'),
  unit: text('unit'),
  category: text('category'),
  takeoffId: text('takeoff_id').references(() => takeoff.id, { onDelete: 'cascade' }),
}, (t) => [
  index('takeoff_item_sheet_id_idx').on(t.sheetId),
  index('takeoff_item_takeoff_id_idx').on(t.takeoffId),
])

// ==================== WARRANTIES ====================

export const warranty = pgTable('warranty', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  name: text('name').notNull(),
  type: text('type').notNull(),
  startDate: timestamp('start_date').notNull(),
  endDate: timestamp('end_date'),
  duration: integer('duration'),
  durationUnit: text('duration_unit'),
  coverage: text('coverage'),
  notes: text('notes'),

  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('warranty_company_id_idx').on(t.companyId),
])

export const warrantyClaim = pgTable('warranty_claim', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  status: text('status').default('open').notNull(),
  description: text('description').notNull(),
  resolution: text('resolution'),
  resolvedAt: timestamp('resolved_at'),

  warrantyId: text('warranty_id').notNull().references(() => warranty.id, { onDelete: 'cascade' }),
  projectWarrantyId: text('project_warranty_id'),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),

  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('warranty_claim_warranty_id_idx').on(t.warrantyId),
])

// ==================== BILLING ====================

export const subscription = pgTable('subscription', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().unique().references(() => company.id),

  stripeSubscriptionId: text('stripe_subscription_id').notNull().unique(),

  packageId: text('package_id').notNull(),
  billingCycle: text('billing_cycle').notNull(),
  status: text('status').default('active').notNull(),

  userCount: integer('user_count').default(1).notNull(),
  basePrice: decimal('base_price', { precision: 10, scale: 2 }).notNull(),
  totalPrice: decimal('total_price', { precision: 10, scale: 2 }).notNull(),
  features: json('features').default([]).notNull(),
  addons: json('addons'),

  trialEndsAt: timestamp('trial_ends_at'),
  currentPeriodStart: timestamp('current_period_start').notNull(),
  currentPeriodEnd: timestamp('current_period_end').notNull(),
  canceledAt: timestamp('canceled_at'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const license = pgTable('license', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id),

  type: text('type').notNull(),
  packageId: text('package_id'),
  features: json('features').notNull(),

  amount: decimal('amount', { precision: 10, scale: 2 }).notNull(),
  stripePaymentId: text('stripe_payment_id'),

  purchasedAt: timestamp('purchased_at').notNull(),
  expiresAt: timestamp('expires_at'),
  status: text('status').default('active').notNull(),

  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('license_company_id_idx').on(t.companyId),
])

export const addonPurchase = pgTable('addon_purchase', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id),

  addonId: text('addon_id').notNull(),
  quantity: integer('quantity').default(1).notNull(),
  amount: decimal('amount', { precision: 10, scale: 2 }).notNull(),
  stripePaymentId: text('stripe_payment_id'),
  expiresAt: timestamp('expires_at'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('addon_purchase_company_id_idx').on(t.companyId),
])

export const usageRecord = pgTable('usage_record', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id),

  type: text('type').notNull(),
  quantity: integer('quantity').default(1).notNull(),
  metadata: json('metadata'),

  recordedAt: timestamp('recorded_at').defaultNow().notNull(),
}, (t) => [
  index('usage_record_company_id_type_recorded_at_idx').on(t.companyId, t.type, t.recordedAt),
])

export const billingInvoice = pgTable('billing_invoice', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id),

  number: text('number').notNull().unique(),
  periodStart: timestamp('period_start').notNull(),
  periodEnd: timestamp('period_end').notNull(),
  lineItems: json('line_items').notNull(),
  subtotal: decimal('subtotal', { precision: 10, scale: 2 }).notNull(),
  tax: decimal('tax', { precision: 10, scale: 2 }).default('0').notNull(),
  total: decimal('total', { precision: 10, scale: 2 }).notNull(),
  status: text('status').default('pending').notNull(),
  dueDate: timestamp('due_date').notNull(),
  paidAt: timestamp('paid_at'),
  stripeInvoiceId: text('stripe_invoice_id'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('billing_invoice_company_id_idx').on(t.companyId),
])

export const selfHostedLicense = pgTable('self_hosted_license', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  email: text('email').notNull(),
  companyName: text('company_name').notNull(),
  licenseType: text('license_type').notNull(),
  licenseKey: text('license_key').notNull().unique(),
  stripeSessionId: text('stripe_session_id'),
  stripeCustomerId: text('stripe_customer_id'),
  purchasedAt: timestamp('purchased_at').notNull(),
  expiresAt: timestamp('expires_at'),
  isActive: boolean('is_active').default(true).notNull(),
  downloadCount: integer('download_count').default(0).notNull(),
  lastDownloadAt: timestamp('last_download_at'),
  metadata: json('metadata'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('self_hosted_license_email_idx').on(t.email),
  index('self_hosted_license_license_key_idx').on(t.licenseKey),
])

// ==================== ONLINE BOOKING ====================

export const bookingSettings = pgTable('booking_settings', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().unique().references(() => company.id),

  enabled: boolean('enabled').default(true).notNull(),
  leadTimeDays: integer('lead_time_days').default(1).notNull(),
  maxDaysOut: integer('max_days_out').default(30).notNull(),
  slotDurationMinutes: integer('slot_duration_minutes').default(60).notNull(),
  workingHours: json('working_hours').notNull(),

  primaryColor: text('primary_color'),
  logo: text('logo'),
  welcomeMessage: text('welcome_message'),
  confirmationMessage: text('confirmation_message'),

  notifyEmail: boolean('notify_email').default(true).notNull(),
  notifySms: boolean('notify_sms').default(false).notNull(),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const bookableService = pgTable('bookable_service', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id),

  name: text('name').notNull(),
  description: text('description'),
  durationMinutes: integer('duration_minutes').default(60).notNull(),
  price: decimal('price', { precision: 10, scale: 2 }).default('0').notNull(),
  depositRequired: boolean('deposit_required').default(false).notNull(),
  depositAmount: decimal('deposit_amount', { precision: 10, scale: 2 }).default('0').notNull(),
  active: boolean('active').default(true).notNull(),
  sortOrder: integer('sort_order').default(0).notNull(),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('bookable_service_company_id_idx').on(t.companyId),
])

export const onlineBooking = pgTable('online_booking', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id),

  jobId: text('job_id').references(() => job.id),
  contactId: text('contact_id').references(() => contact.id),
  serviceId: text('service_id').references(() => bookableService.id),

  customerName: text('customer_name').notNull(),
  customerEmail: text('customer_email').notNull(),
  customerPhone: text('customer_phone'),
  scheduledDate: timestamp('scheduled_date').notNull(),
  notes: text('notes'),
  status: text('status').default('pending').notNull(),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('online_booking_company_id_idx').on(t.companyId),
])

// ==================== CUSTOM FORMS ====================

export const formTemplate = pgTable('form_template', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id),

  name: text('name').notNull(),
  description: text('description'),
  category: text('category').notNull(),
  fields: json('fields').notNull(),

  requireSignature: boolean('require_signature').default(false).notNull(),
  requirePhoto: boolean('require_photo').default(false).notNull(),
  autoAttachTo: json('auto_attach_to'),
  active: boolean('active').default(true).notNull(),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('form_template_company_id_idx').on(t.companyId),
])

export const formSubmission = pgTable('form_submission', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id),

  templateId: text('template_id').notNull().references(() => formTemplate.id),

  jobId: text('job_id').references(() => job.id),
  projectId: text('project_id').references(() => project.id),
  contactId: text('contact_id').references(() => contact.id),

  values: json('values').notNull(),
  signature: text('signature'),
  signedAt: timestamp('signed_at'),
  signedBy: text('signed_by'),

  submittedById: text('submitted_by_id').references(() => user.id),
  submittedAt: timestamp('submitted_at').defaultNow().notNull(),
  status: text('status').default('submitted').notNull(),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('form_submission_company_id_idx').on(t.companyId),
  index('form_submission_template_id_idx').on(t.templateId),
])

// ==================== LIEN WAIVERS ====================

export const lienWaiver = pgTable('lien_waiver', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id),

  projectId: text('project_id').notNull().references(() => project.id),
  vendorId: text('vendor_id').references(() => contact.id),

  vendorName: text('vendor_name').notNull(),
  vendorType: text('vendor_type'),
  waiverType: text('waiver_type').notNull(),

  throughDate: timestamp('through_date'),
  amountPrevious: decimal('amount_previous', { precision: 12, scale: 2 }).default('0').notNull(),
  amountCurrent: decimal('amount_current', { precision: 12, scale: 2 }).default('0').notNull(),
  amountTotal: decimal('amount_total', { precision: 12, scale: 2 }).default('0').notNull(),

  status: text('status').default('draft').notNull(),
  requestedAt: timestamp('requested_at'),
  dueDate: timestamp('due_date'),
  receivedAt: timestamp('received_at'),

  documentUrl: text('document_url'),
  signedDate: timestamp('signed_date'),
  notarized: boolean('notarized').default(false).notNull(),

  approvedAt: timestamp('approved_at'),
  approvedById: text('approved_by_id').references(() => user.id),
  approvalNotes: text('approval_notes'),

  rejectedAt: timestamp('rejected_at'),
  rejectedById: text('rejected_by_id').references(() => user.id),
  rejectionReason: text('rejection_reason'),

  notes: text('notes'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('lien_waiver_company_id_idx').on(t.companyId),
  index('lien_waiver_project_id_idx').on(t.projectId),
])

// ==================== DRAW SCHEDULES ====================

export const scheduleOfValues = pgTable('schedule_of_values', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id),

  projectId: text('project_id').notNull().unique().references(() => project.id),

  contractAmount: decimal('contract_amount', { precision: 12, scale: 2 }).notNull(),
  retainagePercent: decimal('retainage_percent', { precision: 5, scale: 2 }).default('10').notNull(),
  status: text('status').default('draft').notNull(),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('schedule_of_values_company_id_idx').on(t.companyId),
])

export const sovLineItem = pgTable('sov_line_item', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull(),

  scheduleOfValuesId: text('schedule_of_values_id').notNull().references(() => scheduleOfValues.id, { onDelete: 'cascade' }),

  itemNumber: text('item_number').notNull(),
  description: text('description').notNull(),
  scheduledValue: decimal('scheduled_value', { precision: 12, scale: 2 }).notNull(),
  sortOrder: integer('sort_order').default(0).notNull(),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('sov_line_item_schedule_of_values_id_idx').on(t.scheduleOfValuesId),
])

export const drawRequest = pgTable('draw_request', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id),

  scheduleOfValuesId: text('schedule_of_values_id').notNull().references(() => scheduleOfValues.id),
  projectId: text('project_id').notNull().references(() => project.id),

  drawNumber: integer('draw_number').notNull(),
  periodFrom: timestamp('period_from'),
  periodTo: timestamp('period_to'),

  grossAmount: decimal('gross_amount', { precision: 12, scale: 2 }).default('0').notNull(),
  retainageAmount: decimal('retainage_amount', { precision: 12, scale: 2 }).default('0').notNull(),
  netAmount: decimal('net_amount', { precision: 12, scale: 2 }).default('0').notNull(),

  status: text('status').default('draft').notNull(),
  submittedAt: timestamp('submitted_at'),

  approvedAt: timestamp('approved_at'),
  approvedById: text('approved_by_id').references(() => user.id),
  approvalNotes: text('approval_notes'),

  rejectedAt: timestamp('rejected_at'),
  rejectedById: text('rejected_by_id').references(() => user.id),
  rejectionReason: text('rejection_reason'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  uniqueIndex('draw_request_schedule_of_values_id_draw_number_idx').on(t.scheduleOfValuesId, t.drawNumber),
  index('draw_request_company_id_idx').on(t.companyId),
  index('draw_request_project_id_idx').on(t.projectId),
])

export const drawLineItem = pgTable('draw_line_item', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull(),

  drawRequestId: text('draw_request_id').notNull().references(() => drawRequest.id, { onDelete: 'cascade' }),

  sovLineItemId: text('sov_line_item_id').notNull().references(() => sovLineItem.id),

  completedThisPeriod: decimal('completed_this_period', { precision: 12, scale: 2 }).default('0').notNull(),
  materialsStored: decimal('materials_stored', { precision: 12, scale: 2 }).default('0').notNull(),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('draw_line_item_draw_request_id_idx').on(t.drawRequestId),
])

// ==================== AUDIT LOG ====================

export const auditLog = pgTable('audit_log', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  action: text('action').notNull(),
  entity: text('entity').notNull(),
  entityId: text('entity_id'),
  entityName: text('entity_name'),
  changes: json('changes'),
  metadata: json('metadata'),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at').defaultNow().notNull(),

  userId: text('user_id'),
  userName: text('user_name'),
  userEmail: text('user_email'),

  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
}, (t) => [
  index('audit_log_company_id_idx').on(t.companyId),
  index('audit_log_entity_entity_id_idx').on(t.entity, t.entityId),
  index('audit_log_user_id_idx').on(t.userId),
  index('audit_log_created_at_idx').on(t.createdAt),
])

// ==================== MISSING MODELS ====================

export const agreementPlan = pgTable('agreement_plan', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  price: decimal('price', { precision: 12, scale: 2 }).default('0').notNull(),
  billingFrequency: text('billing_frequency').default('annual').notNull(),
  visitsIncluded: integer('visits_included').default(0).notNull(),
  discountPercent: decimal('discount_percent', { precision: 5, scale: 2 }).default('0').notNull(),
  priorityService: boolean('priority_service').default(false).notNull(),
  durationMonths: integer('duration_months').default(12).notNull(),
  autoRenew: boolean('auto_renew').default(true).notNull(),
  includedServices: json('included_services'),
  active: boolean('active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('agreement_plan_company_id_active_idx').on(t.companyId, t.active),
])

export const warrantyTemplate = pgTable('warranty_template', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  category: text('category'),
  durationMonths: integer('duration_months').default(12).notNull(),
  coverageDetails: text('coverage_details'),
  exclusions: text('exclusions'),
  active: boolean('active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('warranty_template_company_id_active_idx').on(t.companyId, t.active),
])

export const projectWarranty = pgTable('project_warranty', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  projectId: text('project_id').references(() => project.id),
  contactId: text('contact_id').references(() => contact.id),
  templateId: text('template_id').references(() => warrantyTemplate.id),
  name: text('name').notNull(),
  category: text('category'),
  description: text('description'),
  coverageDetails: text('coverage_details'),
  exclusions: text('exclusions'),
  startDate: timestamp('start_date'),
  durationMonths: integer('duration_months').default(12).notNull(),
  expiresAt: timestamp('expires_at'),
  documentUrl: text('document_url'),
  status: text('status').default('active').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('project_warranty_company_id_idx').on(t.companyId),
  index('project_warranty_project_id_idx').on(t.projectId),
])

export const takeoffAssembly = pgTable('takeoff_assembly', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  category: text('category'),
  measurementType: text('measurement_type').default('area').notNull(),
  wasteFactor: decimal('waste_factor', { precision: 5, scale: 2 }).default('10').notNull(),
  active: boolean('active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('takeoff_assembly_company_id_active_idx').on(t.companyId, t.active),
])

export const assemblyMaterial = pgTable('assembly_material', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  assemblyId: text('assembly_id').notNull().references(() => takeoffAssembly.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  quantityPer: decimal('quantity_per', { precision: 10, scale: 4 }).default('1').notNull(),
  unit: text('unit').default('each').notNull(),
  unitCost: decimal('unit_cost', { precision: 12, scale: 2 }).default('0').notNull(),
  unitPrice: decimal('unit_price', { precision: 12, scale: 2 }).default('0').notNull(),
  inventoryItemId: text('inventory_item_id').references(() => inventoryItem.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('assembly_material_assembly_id_idx').on(t.assemblyId),
])

export const takeoffSheet = pgTable('takeoff_sheet', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  projectId: text('project_id').references(() => project.id),
  name: text('name').notNull(),
  description: text('description'),
  planReference: text('plan_reference'),
  planUrl: text('plan_url'),
  status: text('status').default('draft').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('takeoff_sheet_company_id_idx').on(t.companyId),
  index('takeoff_sheet_project_id_idx').on(t.projectId),
])

export const recurringInvoice = pgTable('recurring_invoice', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  contactId: text('contact_id').references(() => contact.id),
  projectId: text('project_id').references(() => project.id),
  frequency: text('frequency').default('monthly').notNull(),
  startDate: timestamp('start_date').notNull(),
  endDate: timestamp('end_date'),
  nextRunDate: timestamp('next_run_date').notNull(),
  terms: text('terms').default('30').notNull(),
  subtotal: decimal('subtotal', { precision: 12, scale: 2 }).default('0').notNull(),
  taxRate: decimal('tax_rate', { precision: 5, scale: 2 }).default('0').notNull(),
  taxAmount: decimal('tax_amount', { precision: 12, scale: 2 }).default('0').notNull(),
  discount: decimal('discount', { precision: 12, scale: 2 }).default('0').notNull(),
  total: decimal('total', { precision: 12, scale: 2 }).default('0').notNull(),
  notes: text('notes'),
  autoSend: boolean('auto_send').default(false).notNull(),
  status: text('status').default('active').notNull(),
  lastRunDate: timestamp('last_run_date'),
  invoiceCount: integer('invoice_count').default(0).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('recurring_invoice_company_id_idx').on(t.companyId),
  index('recurring_invoice_next_run_date_idx').on(t.nextRunDate),
])

export const recurringLineItem = pgTable('recurring_line_item', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  recurringInvoiceId: text('recurring_invoice_id').notNull().references(() => recurringInvoice.id, { onDelete: 'cascade' }),
  description: text('description').notNull(),
  quantity: decimal('quantity', { precision: 10, scale: 2 }).default('1').notNull(),
  unitPrice: decimal('unit_price', { precision: 12, scale: 2 }).default('0').notNull(),
  total: decimal('total', { precision: 12, scale: 2 }).default('0').notNull(),
  sortOrder: integer('sort_order').default(0),
}, (t) => [
  index('recurring_line_item_recurring_invoice_id_idx').on(t.recurringInvoiceId),
])

export const equipmentType = pgTable('equipment_type', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  category: text('category'),
  brand: text('brand'),
  defaultWarrantyMonths: integer('default_warranty_months').default(12).notNull(),
  defaultLifespanYears: integer('default_lifespan_years').default(15).notNull(),
  maintenanceIntervalMonths: integer('maintenance_interval_months').default(12).notNull(),
  fields: json('fields'),
  active: boolean('active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('equipment_type_company_id_active_idx').on(t.companyId, t.active),
])

export const emailRecipient = pgTable('email_recipient', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  campaignId: text('campaign_id').notNull().references(() => emailCampaign.id, { onDelete: 'cascade' }),
  contactId: text('contact_id').references(() => contact.id),
  email: text('email').notNull(),
  status: text('status').default('pending').notNull(),
  sentAt: timestamp('sent_at'),
  openedAt: timestamp('opened_at'),
  clickedAt: timestamp('clicked_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('email_recipient_campaign_id_status_idx').on(t.campaignId, t.status),
])

export const task = pgTable('task', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  createdById: text('created_by_id').references(() => user.id),
  assignedToId: text('assigned_to_id').references(() => user.id),
  projectId: text('project_id').references(() => project.id),
  jobId: text('job_id').references(() => job.id),
  contactId: text('contact_id').references(() => contact.id),
  title: text('title').notNull(),
  description: text('description'),
  dueDate: timestamp('due_date'),
  priority: text('priority').default('medium').notNull(),
  status: text('status').default('pending').notNull(),
  checklist: json('checklist'),
  completedAt: timestamp('completed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('task_company_id_idx').on(t.companyId),
  index('task_assigned_to_id_idx').on(t.assignedToId),
  index('task_project_id_idx').on(t.projectId),
  index('task_due_date_idx').on(t.dueDate),
])

export const activity = pgTable('activity', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  userId: text('user_id').references(() => user.id),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  action: text('action').notNull(),
  description: text('description'),
  metadata: json('metadata'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('activity_company_id_idx').on(t.companyId),
  index('activity_entity_type_entity_id_idx').on(t.entityType, t.entityId),
])

export const activityLog = pgTable('activity_log', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  userId: text('user_id').references(() => user.id),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  action: text('action').notNull(),
  description: text('description'),
  metadata: json('metadata'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('activity_log_company_id_idx').on(t.companyId),
  index('activity_log_entity_type_entity_id_idx').on(t.entityType, t.entityId),
])

export const callLog = pgTable('call_log', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  trackingNumberId: text('tracking_number_id').references(() => trackingNumber.id),
  contactId: text('contact_id').references(() => contact.id),
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
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('call_log_company_id_idx').on(t.companyId),
  index('call_log_contact_id_idx').on(t.contactId),
])

export const comment = pgTable('comment', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  userId: text('user_id').references(() => user.id),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  content: text('content').notNull(),
  mentions: json('mentions'),
  attachments: json('attachments'),
  parentId: text('parent_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('comment_company_id_idx').on(t.companyId),
  index('comment_entity_type_entity_id_idx').on(t.entityType, t.entityId),
])

export const commentReaction = pgTable('comment_reaction', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  commentId: text('comment_id').notNull().references(() => comment.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => user.id),
  reaction: text('reaction').notNull(),
}, (t) => [
  uniqueIndex('comment_reaction_comment_id_user_id_reaction_idx').on(t.commentId, t.userId, t.reaction),
  index('comment_reaction_comment_id_idx').on(t.commentId),
])

export const dripSequence = pgTable('drip_sequence', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  trigger: text('trigger').notNull(),
  active: boolean('active').default(false).notNull(),
  steps: json('steps'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('drip_sequence_company_id_idx').on(t.companyId),
])

export const sequenceEnrollment = pgTable('sequence_enrollment', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  sequenceId: text('sequence_id').notNull().references(() => dripSequence.id, { onDelete: 'cascade' }),
  contactId: text('contact_id').notNull().references(() => contact.id, { onDelete: 'cascade' }),
  currentStep: integer('current_step').default(1).notNull(),
  status: text('status').default('active').notNull(),
  nextEmailAt: timestamp('next_email_at'),
  completedAt: timestamp('completed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('sequence_enrollment_sequence_id_idx').on(t.sequenceId),
  index('sequence_enrollment_contact_id_idx').on(t.contactId),
  index('sequence_enrollment_next_email_at_idx').on(t.nextEmailAt),
])

export const emailClick = pgTable('email_click', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  recipientId: text('recipient_id').notNull().references(() => emailRecipient.id, { onDelete: 'cascade' }),
  url: text('url').notNull(),
  clickedAt: timestamp('clicked_at').defaultNow().notNull(),
}, (t) => [
  index('email_click_recipient_id_idx').on(t.recipientId),
])

export const equipmentServiceRecord = pgTable('equipment_service_record', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  equipmentId: text('equipment_id').notNull().references(() => equipment.id, { onDelete: 'cascade' }),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  jobId: text('job_id').references(() => job.id),
  technicianId: text('technician_id').references(() => user.id),
  serviceDate: timestamp('service_date').defaultNow().notNull(),
  serviceType: text('service_type').notNull(),
  description: text('description'),
  partsUsed: json('parts_used'),
  laborHours: decimal('labor_hours', { precision: 8, scale: 2 }),
  cost: decimal('cost', { precision: 12, scale: 2 }),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('equipment_service_record_equipment_id_idx').on(t.equipmentId),
  index('equipment_service_record_company_id_idx').on(t.companyId),
])

export const jobAssignment = pgTable('job_assignment', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  jobId: text('job_id').notNull().references(() => job.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => user.id),
  role: text('role'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  uniqueIndex('job_assignment_job_id_user_id_idx').on(t.jobId, t.userId),
  index('job_assignment_job_id_idx').on(t.jobId),
  index('job_assignment_user_id_idx').on(t.userId),
])

export const oauthState = pgTable('oauth_state', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  state: text('state').notNull().unique(),
  provider: text('provider').notNull(),
  companyId: text('company_id'),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('oauth_state_state_idx').on(t.state),
])

export const photo = pgTable('photo', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  userId: text('user_id').references(() => user.id),
  entityType: text('entity_type'),
  entityId: text('entity_id'),
  filename: text('filename').notNull(),
  originalName: text('original_name'),
  mimeType: text('mime_type').default('image/jpeg').notNull(),
  size: integer('size'),
  width: integer('width'),
  height: integer('height'),
  thumbnailPath: text('thumbnail_path'),
  caption: text('caption'),
  tags: json('tags'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('photo_company_id_idx').on(t.companyId),
  index('photo_entity_type_entity_id_idx').on(t.entityType, t.entityId),
])

export const pricebookGoodBetterBest = pgTable('pricebook_good_better_best', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  pricebookItemId: text('pricebook_item_id').notNull().references(() => pricebookItem.id, { onDelete: 'cascade' }),
  tier: text('tier').notNull(),
  name: text('name'),
  description: text('description'),
  price: decimal('price', { precision: 12, scale: 2 }).notNull(),
  features: json('features'),
}, (t) => [
  index('pricebook_good_better_best_pricebook_item_id_idx').on(t.pricebookItemId),
])

export const pricebookMaterial = pgTable('pricebook_material', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  pricebookItemId: text('pricebook_item_id').notNull().references(() => pricebookItem.id, { onDelete: 'cascade' }),
  inventoryItemId: text('inventory_item_id').references(() => inventoryItem.id),
  quantity: decimal('quantity', { precision: 10, scale: 4 }).default('1').notNull(),
  priceOverride: decimal('price_override', { precision: 12, scale: 2 }),
}, (t) => [
  index('pricebook_material_pricebook_item_id_idx').on(t.pricebookItemId),
])

export const product = pgTable('product', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  sku: text('sku'),
  price: decimal('price', { precision: 12, scale: 2 }).default('0').notNull(),
  category: text('category'),
  active: boolean('active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('product_company_id_idx').on(t.companyId),
])

export const projectBaseline = pgTable('project_baseline', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  projectId: text('project_id').notNull().references(() => project.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  taskSnapshots: json('task_snapshots'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('project_baseline_project_id_idx').on(t.projectId),
])

export const projectSelection = pgTable('project_selection', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  projectId: text('project_id').notNull().references(() => project.id, { onDelete: 'cascade' }),
  categoryId: text('category_id').references(() => selectionCategory.id),
  name: text('name').notNull(),
  description: text('description'),
  location: text('location'),
  allowance: decimal('allowance', { precision: 12, scale: 2 }),
  quantity: integer('quantity').default(1),
  unit: text('unit').default('each'),
  dueDate: timestamp('due_date'),
  availableOptions: json('available_options'),
  status: text('status').default('pending').notNull(),
  selectedOptionId: text('selected_option_id'),
  selectedAt: timestamp('selected_at'),
  selectedById: text('selected_by_id'),
  clientNotes: text('client_notes'),
  priceDifference: decimal('price_difference', { precision: 12, scale: 2 }),
  approvedAt: timestamp('approved_at'),
  approvedById: text('approved_by_id'),
  orderedAt: timestamp('ordered_at'),
  orderNumber: text('order_number'),
  expectedDelivery: timestamp('expected_delivery'),
  receivedAt: timestamp('received_at'),
  receivedNotes: text('received_notes'),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('project_selection_project_id_idx').on(t.projectId),
])

export const projectTask = pgTable('project_task', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  projectId: text('project_id').notNull().references(() => project.id, { onDelete: 'cascade' }),
  parentId: text('parent_id'),
  name: text('name').notNull(),
  description: text('description'),
  startDate: timestamp('start_date'),
  endDate: timestamp('end_date'),
  duration: integer('duration'),
  progress: integer('progress').default(0).notNull(),
  assignedToId: text('assigned_to_id').references(() => user.id),
  status: text('status').default('not_started').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('project_task_project_id_idx').on(t.projectId),
  index('project_task_parent_id_idx').on(t.parentId),
])

export const taskDependency = pgTable('task_dependency', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  projectId: text('project_id').notNull().references(() => project.id, { onDelete: 'cascade' }),
  predecessorId: text('predecessor_id').notNull().references(() => projectTask.id, { onDelete: 'cascade' }),
  successorId: text('successor_id').notNull().references(() => projectTask.id, { onDelete: 'cascade' }),
  type: text('type').default('finish_to_start').notNull(),
  lagDays: integer('lag_days').default(0).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('task_dependency_project_id_idx').on(t.projectId),
])

export const selectionOption = pgTable('selection_option', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  categoryId: text('category_id').references(() => selectionCategory.id),
  name: text('name').notNull(),
  description: text('description'),
  manufacturer: text('manufacturer'),
  model: text('model'),
  sku: text('sku'),
  price: decimal('price', { precision: 12, scale: 2 }).default('0').notNull(),
  cost: decimal('cost', { precision: 12, scale: 2 }).default('0'),
  unit: text('unit').default('each'),
  imageUrl: text('image_url'),
  images: json('images'),
  specSheet: text('spec_sheet'),
  leadTimeDays: integer('lead_time_days').default(0),
  inStock: boolean('in_stock').default(true),
  active: boolean('active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('selection_option_company_id_idx').on(t.companyId),
  index('selection_option_category_id_idx').on(t.categoryId),
])

export const smsAutoResponder = pgTable('sms_auto_responder', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  trigger: text('trigger').notNull(),
  keywords: json('keywords'),
  message: text('message').notNull(),
  afterHoursOnly: boolean('after_hours_only').default(false).notNull(),
  active: boolean('active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('sms_auto_responder_company_id_idx').on(t.companyId),
])

export const takeoffCalculatedMaterial = pgTable('takeoff_calculated_material', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  itemId: text('item_id').notNull(),
  materialName: text('material_name').notNull(),
  unit: text('unit').notNull(),
  baseQuantity: decimal('base_quantity', { precision: 12, scale: 4 }).notNull(),
  wasteQuantity: decimal('waste_quantity', { precision: 12, scale: 4 }).default('0').notNull(),
  totalQuantity: decimal('total_quantity', { precision: 12, scale: 4 }).notNull(),
  unitCost: decimal('unit_cost', { precision: 12, scale: 2 }).default('0').notNull(),
  unitPrice: decimal('unit_price', { precision: 12, scale: 2 }).default('0').notNull(),
  totalCost: decimal('total_cost', { precision: 12, scale: 2 }).default('0').notNull(),
  totalPrice: decimal('total_price', { precision: 12, scale: 2 }).default('0').notNull(),
  inventoryItemId: text('inventory_item_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('takeoff_calculated_material_item_id_idx').on(t.itemId),
])

// ==================== SUPPORT TICKETS ====================

export const supportTicket = pgTable('support_ticket', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  number: text('number').notNull(),
  subject: text('subject').notNull(),
  description: text('description'),
  status: text('status').default('open').notNull(), // open, in_progress, waiting, resolved, closed
  priority: text('priority').default('normal').notNull(), // low, normal, high, urgent, critical
  category: text('category'), // billing, technical, feature_request, bug, general
  type: text('type').default('internal').notNull(), // internal (from CRM users) or external (from contacts/clients)
  source: text('source').default('portal').notNull(), // portal, email, ai_chat, phone, api

  // SLA tracking
  slaResponseDue: timestamp('sla_response_due'),
  slaResolveDue: timestamp('sla_resolve_due'),
  firstResponseAt: timestamp('first_response_at'),
  resolvedAt: timestamp('resolved_at'),
  closedAt: timestamp('closed_at'),
  escalatedAt: timestamp('escalated_at'),
  escalationLevel: integer('escalation_level').default(0).notNull(),

  // AI fields
  aiSuggested: boolean('ai_suggested').default(false).notNull(),
  aiCategory: text('ai_category'),
  aiPriorityScore: integer('ai_priority_score'),

  // Rating
  rating: integer('rating'), // 1-5 post-resolution
  ratingComment: text('rating_comment'),

  // Relations
  contactId: text('contact_id').references(() => contact.id, { onDelete: 'set null' }),
  assignedToId: text('assigned_to_id').references(() => user.id, { onDelete: 'set null' }),
  createdById: text('created_by_id').references(() => user.id, { onDelete: 'set null' }),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),

  // Tags & metadata
  tags: json('tags').default([]).notNull(),
  metadata: json('metadata').default({}).notNull(),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('support_ticket_company_id_idx').on(t.companyId),
  index('support_ticket_status_idx').on(t.status),
  index('support_ticket_priority_idx').on(t.priority),
  index('support_ticket_assigned_to_idx').on(t.assignedToId),
  index('support_ticket_contact_id_idx').on(t.contactId),
  index('support_ticket_category_idx').on(t.category),
])

export const supportTicketMessage = pgTable('support_ticket_message', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  body: text('body').notNull(),
  isInternal: boolean('is_internal').default(false).notNull(), // internal note vs visible reply
  isAi: boolean('is_ai').default(false).notNull(),
  attachments: json('attachments').default([]).notNull(),

  ticketId: text('ticket_id').notNull().references(() => supportTicket.id, { onDelete: 'cascade' }),
  userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
  contactId: text('contact_id').references(() => contact.id, { onDelete: 'set null' }),

  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('support_ticket_message_ticket_id_idx').on(t.ticketId),
])

export const supportKnowledgeBase = pgTable('support_knowledge_base', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  title: text('title').notNull(),
  content: text('content').notNull(),
  category: text('category'),
  tags: json('tags').default([]).notNull(),
  isFaq: boolean('is_faq').default(false).notNull(),
  published: boolean('published').default(true).notNull(),
  sortOrder: integer('sort_order').default(0).notNull(),
  viewCount: integer('view_count').default(0).notNull(),

  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  createdById: text('created_by_id').references(() => user.id, { onDelete: 'set null' }),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('support_kb_company_id_idx').on(t.companyId),
  index('support_kb_category_idx').on(t.category),
])

export const supportSlaPolicy = pgTable('support_sla_policy', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  name: text('name').notNull(),
  priority: text('priority').notNull(), // maps to ticket priority
  responseTimeMinutes: integer('response_time_minutes').notNull(),
  resolveTimeMinutes: integer('resolve_time_minutes').notNull(),
  escalateAfterMinutes: integer('escalate_after_minutes'),
  active: boolean('active').default(true).notNull(),

  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),

  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('support_sla_policy_company_id_idx').on(t.companyId),
])

export const pushSubscription = pgTable('push_subscription', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  endpoint: text('endpoint').notNull().unique(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('push_subscription_user_id_idx').on(t.userId),
])

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
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
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
  convertedContactId: text('converted_contact_id').references(() => contact.id, { onDelete: 'set null' }),
  contactedAt: timestamp('contacted_at'),
  receivedAt: timestamp('received_at').defaultNow().notNull(),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('lead_company_id_idx').on(t.companyId),
  index('lead_status_idx').on(t.status),
  index('lead_source_platform_idx').on(t.sourcePlatform),
  index('lead_received_at_idx').on(t.receivedAt),
])
