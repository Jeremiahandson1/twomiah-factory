// CRM layer (SPEC §4.4): contacts and the website's leads, projects, jobs, quotes, invoices and payments, time and
// expenses, documents, the team, the schedule, forms, recurring invoices, tasks, activity, comments, branches and
// commissions. Column for column the base CRM's tables (templates/crm/backend/db/schema.ts), so a tenant's rows
// move across unchanged. Present in every tenant: a website enquiry is a lead or a contact even for a business
// without the CRM switched on (SPEC §4.7). New here: job.booking_id, the booking a job was made from (SPEC §4.7).
import { type AnyPgColumn, pgTable, text, boolean, integer, decimal, real, timestamp, json, uniqueIndex, index } from 'drizzle-orm/pg-core'
import { createId } from '@paralleldrive/cuid2'
import { equipment } from './field.ts'
import { site } from './trades.ts'
import { event } from './events.ts'
import { patient } from './vet.ts'
import { booking } from './booking.ts'
import { crew, measurementReport } from './roof.ts'
import { company, user } from './core.ts'
import { commissionIsAuto, commissionIsReversal, invoiceIsLive } from '../../data/indexWhere.ts'

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
  qbCustomerId: text('qb_customer_id'),
  portalEnabled: boolean('portal_enabled').default(false).notNull(),
  portalToken: text('portal_token'),
  portalTokenExp: timestamp('portal_token_exp'),
  lastPortalVisit: timestamp('last_portal_visit'),
  /** Withdrawn SMS consent: the shared sender refuses to text a contact carrying this. */
  optedOutSms: boolean('opted_out_sms').default(false).notNull(),
  emailOptOut: boolean('email_opt_out').default(false).notNull(),
  emailOptOutAt: timestamp('email_opt_out_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),

  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  // From the near-copy CRMs (see each column): contact's columns they added.
  // When this client was last chased — the win-back list's equivalent of the vaccination stamp, so a
  // lapsed client is not texted again the next morning by whoever opens the page. (Vet T12 M9)
  lastRemindedAt: timestamp('last_reminded_at'),
  // Residential or commercial — how a roofer files a customer (templates/crm-roof contact.property_type).
  propertyType: text('property_type'),
}, (t) => [
  index('contact_company_id_idx').on(t.companyId),
  index('contact_type_idx').on(t.type),
])

// ==================== TEXTING CONSENT ====================

/**
 * Who agreed to be texted, by phone number (E.164): the record carriers ask a business to keep (A2P 10DLC). Keyed by
 * the number, not by a contact or a lead — a website enquiry may land in the Lead Inbox, a dealership's pipeline or the
 * bar's guest list, and becomes a contact later; the consent belongs to the number. Written when a visitor ticks
 * "Text me" on a website form or a booking (site/smsConsent.ts), or texts the business first. Withdrawal is the
 * carrier STOP and contact.optedOutSms; this is the "yes".
 */
export const smsConsent = pgTable('sms_consent', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  phone: text('phone').notNull(),
  /** 'website_form' | 'booking' | 'texted_first' */
  source: text('source').notNull(),
  /** The page the box was ticked on, when it was a form. */
  page: text('page'),
  ip: text('ip'),
  /** The words beside the box, as shown — the consent is to what it said. */
  wording: text('wording'),
  givenAt: timestamp('given_at').defaultNow().notNull(),
}, (t) => [
  uniqueIndex('sms_consent_company_phone_idx').on(t.companyId, t.phone),
])

// ==================== LEAD INBOX ====================

export const leadSource = pgTable('lead_source', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  platform: text('platform').notNull(), // angi, homeadvisor, thumbtack, google_lsa, houzz, other
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
  status: text('status').default('new').notNull(), // new, contacted, converted, dismissed
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
  index('lead_platform_idx').on(t.sourcePlatform),
  index('lead_received_at_idx').on(t.receivedAt),
])

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

export const job = pgTable('job', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  number: text('number').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  status: text('status').default('scheduled').notNull(),
  priority: text('priority').default('normal').notNull(),
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

  /** The booking this job was made from (SPEC §4.7). */
  bookingId: text('booking_id').references(() => booking.id, { onDelete: 'set null' }),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  projectId: text('project_id').references(() => project.id, { onDelete: 'set null' }),
  contactId: text('contact_id').references(() => contact.id, { onDelete: 'set null' }),
  assignedToId: text('assigned_to_id').references(() => user.id, { onDelete: 'set null' }),
  /** roster-only crew (no login) assigned instead of a user — exactly one of the two is set (T21 M12) */
  assignedToMemberId: text('assigned_to_member_id').references(() => teamMember.id, { onDelete: 'set null' }),
  /** The branch this job belongs to (multi_location). Plain text like the other branch references. */
  locationId: text('location_id'),
  createdById: text('created_by_id').references(() => user.id, { onDelete: 'set null' }),
  quoteId: text('quote_id').references(() => quote.id, { onDelete: 'set null' }),
  subcontractorId: text('subcontractor_id').references(() => contact.id, { onDelete: 'set null' }),
  // From the near-copy CRMs (see each column): job's columns they added.
  // job.job_type: see the note at its first use (verticals differ on the default)
  jobType: text('job_type').default('service').notNull(),
  equipmentId: text('equipment_id').references(() => equipment.id, { onDelete: 'set null' }),
  siteId: text('site_id').references(() => site.id, { onDelete: 'set null' }),
  serviceAgreementId: text('service_agreement_id'),
  // Roofing's job (templates/crm-roof job; docs/UNIFIED_ROOF_PLAN.md decision 2). Nullable: no other vertical writes
  // them. Roofing's job_number / property_address / estimated_revenue are this table's number / address /
  // estimated_value; its money is the CRM's precision (12, 2), wider than roofing's (10, 2), so every value fits.
  assignedSalesRepId: text('assigned_sales_rep_id').references(() => user.id, { onDelete: 'set null' }),
  assignedCrewId: text('assigned_crew_id').references((): AnyPgColumn => crew.id, { onDelete: 'set null' }),
  roofAge: integer('roof_age'),
  roofType: text('roof_type'),
  stories: integer('stories'),
  claimNumber: text('claim_number'),
  insuranceCompany: text('insurance_company'),
  adjusterName: text('adjuster_name'),
  adjusterPhone: text('adjuster_phone'),
  dateOfLoss: timestamp('date_of_loss'),
  deductible: decimal('deductible', { precision: 12, scale: 2 }),
  rcv: decimal('rcv', { precision: 12, scale: 2 }),
  acv: decimal('acv', { precision: 12, scale: 2 }),
  approvedScope: text('approved_scope'),
  finalRevenue: decimal('final_revenue', { precision: 12, scale: 2 }),
  materialCost: decimal('material_cost', { precision: 12, scale: 2 }),
  laborCost: decimal('labor_cost', { precision: 12, scale: 2 }),
  inspectionDate: timestamp('inspection_date'),
  inspectionNotes: text('inspection_notes'),
  installDate: timestamp('install_date'),
  installEndDate: timestamp('install_end_date'),
  measurementReportId: text('measurement_report_id').references((): AnyPgColumn => measurementReport.id, { onDelete: 'set null' }),
  totalSquares: decimal('total_squares', { precision: 10, scale: 2 }),
  // Why a job ended without being paid, and when (roofing's close with a reason).
  lostReason: text('lost_reason'),
  closedAt: timestamp('closed_at'),
}, (t) => [
  index('job_company_id_idx').on(t.companyId),
  index('job_status_idx').on(t.status),
  index('job_scheduled_date_idx').on(t.scheduledDate),
  index('job_assigned_to_id_idx').on(t.assignedToId),
  index('job_subcontractor_id_idx').on(t.subcontractorId),
])

/**
 * What each job was last announced to its person as — who it is assigned to and when it is scheduled (crm/notify/
 * jobAssignments.ts). A job that differs from its row here has been assigned or rescheduled since, by whichever screen or
 * route, and its person gets a phone notification. Filled from the jobs that existed when it was made (migration 0015),
 * so nobody is told about work they already had.
 */
export const jobPushState = pgTable('job_push_state', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  /** One row per job. */
  jobId: text('job_id').notNull().references(() => job.id, { onDelete: 'cascade' }),
  assigneeId: text('assignee_id'),
  /** 'YYYY-MM-DD HH:MM' (or the day alone) — data/phonePush.ts SCHEDULED_FOR, the one place it is computed. */
  scheduledFor: text('scheduled_for'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  uniqueIndex('job_push_state_job_id_idx').on(t.jobId),
])

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
  signedBy: text('signed_by'),
  signedIp: text('signed_ip'),
  signedUserAgent: text('signed_user_agent'),
  signatureHash: text('signature_hash'),
  consentAt: timestamp('consent_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),

  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  contactId: text('contact_id').references(() => contact.id, { onDelete: 'set null' }),
  projectId: text('project_id').references(() => project.id, { onDelete: 'set null' }),
  // From the near-copy CRMs (see each column): quote's columns they added.
  customerMessage: text('customer_message'),
  declinedAt: timestamp('declined_at'),
  siteId: text('site_id').references(() => site.id, { onDelete: 'set null' }),
  equipmentId: text('equipment_id').references(() => equipment.id, { onDelete: 'set null' }),
  convertedToJobId: text('converted_to_job_id'),
  // The job a quote is for (templates/crm-roof quote.job_id): a roofing proposal belongs to its job, as the invoice does.
  jobId: text('job_id').references((): AnyPgColumn => job.id, { onDelete: 'set null' }),
  // The quote's own private link (/d/<token>), minted when it is first sent: the customer opens it from the email to see
  // the quote and approve or decline it, with or without a client portal (2026-10-22: a quote went out with no way to
  // accept it unless the portal was on). packages/tenant-backend portal/documentLinks.ts.
  publicToken: text('public_token').unique(),
}, (t) => [
  index('quote_company_id_idx').on(t.companyId),
  index('quote_status_idx').on(t.status),
])

export const quoteLineItem = pgTable('quote_line_item', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  description: text('description').notNull(),
  type: text('type'),
  /**
   * WHAT THE LINE COSTS US, and the catalogue item it was priced from. (T49)
   *
   * Job costing used to estimate cost from `total` — the line's PRICE — which states a 0% margin on
   * work nobody has costed. crm-fieldservice gained these two in its migration 0024 and these three
   * templates never ran it, so they kept the price-as-cost behaviour for two more rounds.
   *
   * Nullable on purpose: an uncosted line records NO cost rather than zero, and job costing counts it
   * in `uncostedLines` instead of pricing the work at nothing.
   */
  unitCost: decimal('unit_cost', { precision: 12, scale: 2 }),
  pricebookItemId: text('pricebook_item_id'),
  quantity: decimal('quantity', { precision: 10, scale: 2 }).default('1').notNull(),
  unitPrice: decimal('unit_price', { precision: 12, scale: 2 }).default('0').notNull(),
  total: decimal('total', { precision: 12, scale: 2 }).default('0').notNull(),
  sortOrder: integer('sort_order').default(0).notNull(),

  quoteId: text('quote_id').notNull().references(() => quote.id, { onDelete: 'cascade' }),
}, (t) => [
  index('quote_line_item_quote_id_idx').on(t.quoteId),
])

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
  amountRefunded: decimal('amount_refunded', { precision: 12, scale: 2 }).default('0').notNull(), // money returned; amountPaid stays gross so a refund never reopens a balance
  notes: text('notes'),
  qbInvoiceId: text('qb_invoice_id'),
  syncedAt: timestamp('synced_at'),
  terms: text('terms'),
  sentAt: timestamp('sent_at'),
  paidAt: timestamp('paid_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),

  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  contactId: text('contact_id').references(() => contact.id, { onDelete: 'set null' }),
  projectId: text('project_id').references(() => project.id, { onDelete: 'set null' }),
  quoteId: text('quote_id').unique().references(() => quote.id, { onDelete: 'set null' }),
  // From the near-copy CRMs (see each column): invoice's columns they added.
  jobId: text('job_id').references(() => job.id, { onDelete: 'set null' }),
  // Private parties: the one invoice that carries a party's money (deposits, balance). One per event.
  eventId: text('event_id').references(() => event.id, { onDelete: 'set null' }),
  appointmentId: text('appointment_id'),                     // salon: the visit this sale closed (services/salonCheckout.ts)
  // The owner pays it, but the bill is FOR an animal. (Vet T12 M6)
  patientId: text('patient_id').references(() => patient.id, { onDelete: 'set null' }),
  // The invoice's own private link (/d/<token>), minted when it is first sent: the customer sees it and pays it there
  // (2026-10-22: the email carried no way to pay). packages/tenant-backend portal/documentLinks.ts.
  publicToken: text('public_token').unique(),
}, (t) => [
  index('invoice_company_id_idx').on(t.companyId),
  index('invoice_status_idx').on(t.status),
  // Two live invoices never share a number: the database's backstop under numbering and "bill once" (Vet T41: a race
  // double-billed and twice shared a number). For every vertical, not only the vet's.
  uniqueIndex('invoice_company_number_live_unique_idx').on(t.companyId, t.number).where(invoiceIsLive),
  // One bill per salon visit (templates/crm-salon schema.ts): checkout relies on this refusal. NULLs never collide, so every
  // invoice raised by hand, with no appointment, is untouched.
  uniqueIndex('invoice_appointment_unique').on(t.companyId, t.appointmentId),
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
  // From the near-copy CRMs (see each column): payment's columns they added.
  tipAmount: decimal('tip_amount', { precision: 12, scale: 2 }).default('0').notNull(), // gratuity, on top of `amount` (never counts toward the invoice)
}, (t) => [
  index('payment_invoice_id_idx').on(t.invoiceId),
])

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
  // Who submitted it, who approved it, who paid it. Without a submitter the server cannot tell
  // whose expense this is — so a manager could approve and reimburse their own, a stylist saw
  // everyone's, and the Edit/Delete offered on their own row always answered 403. (Salon RR6 E1/E7)
  submittedById: text('submitted_by_id'),
  approvedById: text('approved_by_id'),
  approvedAt: timestamp('approved_at'),
  reimbursedById: text('reimbursed_by_id'),
  // Money that came BACK against a reimbursed expense — an over-payment the person handed back.
  // Cumulative, so several partial repayments add up, the way orders.refundedAmount already works.
  // The expense keeps the amount it was paid at; this says how much of it returned. (RR8/X6)
  repaidAmount: decimal('repaid_amount', { precision: 12, scale: 2 }).default('0').notNull(),
  repaidAt: timestamp('repaid_at'),
  repaidById: text('repaid_by_id'),
  repaidReason: text('repaid_reason'),
  // What was held back from this claim to clear what the person owed, so a reimbursement that paid
  // 50 in cash and put 10 against a debt does not read as a short payment. (Salon RR9)
  appliedToOwed: decimal('applied_to_owed', { precision: 12, scale: 2 }).default('0').notNull(),
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
  // From the near-copy CRMs (see each column): document's columns they added.
  // A file belongs to the animal, not only to the person who pays the bill. (Vet T12 M6)
  patientId: text('patient_id').references(() => patient.id, { onDelete: 'set null' }),
}, (t) => [
  index('document_company_id_idx').on(t.companyId),
  index('document_project_id_idx').on(t.projectId),
  index('document_contact_id_idx').on(t.contactId),
  index('document_type_idx').on(t.type),
])

export const documentShare = pgTable('document_share', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  documentId: text('document_id').notNull().references(() => document.id, { onDelete: 'cascade' }),
  contactId: text('contact_id').notNull().references(() => contact.id, { onDelete: 'cascade' }),
  sharedById: text('shared_by_id').references(() => user.id, { onDelete: 'set null' }),
  sharedAt: timestamp('shared_at').defaultNow().notNull(),
}, (t) => [
  uniqueIndex('document_share_unique').on(t.documentId, t.contactId),
  index('document_share_contact_idx').on(t.contactId),
])

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
  /** The branch this person works out of (multi_location). */
  locationId: text('location_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),

  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
}, (t) => [
  index('team_member_company_id_idx').on(t.companyId),
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

export const comment = pgTable('comment', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  userId: text('user_id').references(() => user.id),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  content: text('content').notNull(),
  mentions: json('mentions'),
  attachments: json('attachments'),
  parentId: text('parent_id').references((): AnyPgColumn => comment.id, { onDelete: 'set null' }),
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

export const location = pgTable('location', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  code: text('code').notNull(),
  address: text('address'),
  city: text('city'),
  state: text('state'),
  zip: text('zip'),
  phone: text('phone'),
  email: text('email'),
  timezone: text('timezone').default('America/Chicago').notNull(),
  serviceAreaRadiusMiles: integer('service_area_radius_miles').default(25).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  managerUserId: text('manager_user_id'),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('location_company_id_idx').on(t.companyId),
  uniqueIndex('location_company_code_unique').on(t.companyId, t.code),
])

export const commissionPlan = pgTable('commission_plan', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  planType: text('plan_type').notNull(),
  flatRateAmount: decimal('flat_rate_amount', { precision: 10, scale: 2 }),
  percentRate: decimal('percent_rate', { precision: 5, scale: 2 }),
  tiers: json('tiers'),
  appliesToRole: text('applies_to_role'),
  isActive: boolean('is_active').default(true).notNull(),
  effectiveFrom: timestamp('effective_from'),
  effectiveTo: timestamp('effective_to'),
  // Who the plan pays by itself when an invoice is paid in full: 'none' (record by hand), 'job_assignee'
  // (the person assigned the job — crews, technicians) or 'job_creator' (whoever booked the job — sales).
  autoEarn: text('auto_earn').default('none').notNull(),
  // When automatic earning was switched on. Only invoices paid from then on earn — never imported history.
  autoSince: timestamp('auto_since'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('commission_plan_company_id_idx').on(t.companyId),
])

export const commission = pgTable('commission', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  planId: text('plan_id').references(() => commissionPlan.id, { onDelete: 'set null' }),
  userId: text('user_id').notNull(),
  jobId: text('job_id'),
  invoiceId: text('invoice_id'),
  baseAmount: decimal('base_amount', { precision: 12, scale: 2 }).notNull(),
  rateApplied: decimal('rate_applied', { precision: 5, scale: 2 }),
  commissionAmount: decimal('commission_amount', { precision: 12, scale: 2 }).notNull(),
  earnedAt: timestamp('earned_at').defaultNow().notNull(),
  periodStart: timestamp('period_start'),
  periodEnd: timestamp('period_end'),
  status: text('status').default('pending').notNull(),
  paidAt: timestamp('paid_at'),
  notes: text('notes'),
  // 'manual' (recorded on the screen), 'auto' (earned when its invoice was paid), 'reversal' (taking back an auto
  // earning already paid out, when the invoice was refunded in full).
  source: text('source').default('manual').notNull(),
  reversalOf: text('reversal_of'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('commission_company_id_idx').on(t.companyId),
  index('commission_user_id_idx').on(t.userId),
  index('commission_status_idx').on(t.status),
  // An invoice earns a plan's commission for a person ONCE, however many times the sweep or a webhook sees it paid.
  uniqueIndex('commission_auto_once').on(t.invoiceId, t.planId, t.userId).where(commissionIsAuto),
  uniqueIndex('commission_reversal_once').on(t.reversalOf).where(commissionIsReversal),
])

export const staffAccountEntry = pgTable('staff_account_entry', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  /** Positive = held for them, negative = owed by them. */
  amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
  source: text('source').notNull(),
  /** Why, in words somebody will read back months later. Never optional — an unexplained movement is a bug. */
  reason: text('reason').notNull(),
  /** The claim this movement is about, when there is one. */
  expenseId: text('expense_id').references(() => expense.id, { onDelete: 'set null' }),
  createdBy: text('created_by'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('staff_account_entry_company_id_idx').on(t.companyId),
  index('staff_account_entry_user_id_idx').on(t.userId),
])
