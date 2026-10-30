// Construction layer: purchase orders and bills against a job, plans and their markup, daily logs, RFIs, submittals,
// change orders, punch lists, inspections, bids, selections, takeoffs, warranties, lien waivers, draw schedules, AIA
// forms and project schedules. Column for column the base CRM's tables (templates/crm/backend/db/schema.ts), so a
// tenant's rows move across unchanged; timestamps without a zone (RULEBOOK §2).
import { pgTable, text, boolean, integer, decimal, timestamp, json, uniqueIndex, index } from 'drizzle-orm/pg-core'
import { createId } from '@paralleldrive/cuid2'
import { company, user } from './core.ts'
import { contact, document, job, project } from './crm.ts'
import { inventoryItem } from './field.ts'

export const jobPurchaseOrder = pgTable('job_purchase_order', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  number: text('number').notNull(),
  // draft -> sent -> acknowledged | declined -> received -> billed; cancelled anywhere
  status: text('status').default('draft').notNull(),
  issueDate: timestamp('issue_date').defaultNow().notNull(),
  expectedDate: timestamp('expected_date'),
  shipTo: text('ship_to'),
  subtotal: decimal('subtotal', { precision: 12, scale: 2 }).default('0').notNull(),
  taxRate: decimal('tax_rate', { precision: 5, scale: 2 }).default('0').notNull(),
  taxAmount: decimal('tax_amount', { precision: 12, scale: 2 }).default('0').notNull(),
  total: decimal('total', { precision: 12, scale: 2 }).default('0').notNull(),
  notes: text('notes'),
  vendorAcknowledgedAt: timestamp('vendor_acknowledged_at'),
  vendorDeclinedReason: text('vendor_declined_reason'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),

  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  vendorId: text('vendor_id').references(() => contact.id, { onDelete: 'set null' }),
  projectId: text('project_id').references(() => project.id, { onDelete: 'set null' }),
  jobId: text('job_id').references(() => job.id, { onDelete: 'set null' }),
  createdById: text('created_by_id').references(() => user.id, { onDelete: 'set null' }),
}, (t) => [
  index('job_purchase_order_company_id_idx').on(t.companyId),
  index('job_purchase_order_vendor_id_idx').on(t.vendorId),
  index('job_purchase_order_job_id_idx').on(t.jobId),
])

export const jobPurchaseOrderLine = pgTable('job_purchase_order_line', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  description: text('description').notNull(),
  quantity: decimal('quantity', { precision: 12, scale: 2 }).default('1').notNull(),
  unitCost: decimal('unit_cost', { precision: 12, scale: 2 }).default('0').notNull(),
  total: decimal('total', { precision: 12, scale: 2 }).default('0').notNull(),
  sortOrder: integer('sort_order').default(0).notNull(),

  purchaseOrderId: text('purchase_order_id').notNull().references(() => jobPurchaseOrder.id, { onDelete: 'cascade' }),
}, (t) => [
  index('job_purchase_order_line_po_idx').on(t.purchaseOrderId),
])

export const vendorBill = pgTable('vendor_bill', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  // The vendor's own invoice number — not ours, so no generated sequence.
  number: text('number'),
  status: text('status').default('open').notNull(), // open | partial | paid | void
  billDate: timestamp('bill_date').defaultNow().notNull(),
  dueDate: timestamp('due_date'),
  amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
  amountPaid: decimal('amount_paid', { precision: 12, scale: 2 }).default('0').notNull(),
  paidAt: timestamp('paid_at'),
  fileUrl: text('file_url'),
  notes: text('notes'),
  source: text('source').default('manual').notNull(), // manual | vendor_portal
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),

  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  vendorId: text('vendor_id').references(() => contact.id, { onDelete: 'set null' }),
  projectId: text('project_id').references(() => project.id, { onDelete: 'set null' }),
  jobId: text('job_id').references(() => job.id, { onDelete: 'set null' }),
  purchaseOrderId: text('purchase_order_id').references(() => jobPurchaseOrder.id, { onDelete: 'set null' }),
}, (t) => [
  index('vendor_bill_company_id_idx').on(t.companyId),
  // see vendorBillPayment below — the ledger that makes amount_paid reconcilable
  index('vendor_bill_vendor_id_idx').on(t.vendorId),
  index('vendor_bill_job_id_idx').on(t.jobId),
])

export const vendorBillPayment = pgTable('vendor_bill_payment', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  vendorBillId: text('vendor_bill_id').notNull().references(() => vendorBill.id, { onDelete: 'cascade' }),
  amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
  method: text('method'),
  reference: text('reference'),
  notes: text('notes'),
  paidAt: timestamp('paid_at').defaultNow().notNull(),
  recordedById: text('recorded_by_id').references(() => user.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('vendor_bill_payment_bill_idx').on(t.vendorBillId),
  index('vendor_bill_payment_company_idx').on(t.companyId),
])

export const documentVersion = pgTable('document_version', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  versionNumber: integer('version_number').notNull(),
  filename: text('filename').notNull(),
  originalName: text('original_name').notNull(),
  mimeType: text('mime_type'),
  size: integer('size'),
  path: text('path').notNull(),
  url: text('url').notNull(),
  note: text('note'),
  createdAt: timestamp('created_at').defaultNow().notNull(),

  documentId: text('document_id').notNull().references(() => document.id, { onDelete: 'cascade' }),
  uploadedById: text('uploaded_by_id').references(() => user.id, { onDelete: 'set null' }),
}, (t) => [
  index('document_version_document_id_idx').on(t.documentId),
])

export const planMarkup = pgTable('plan_markup', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  name: text('name').default('Markup').notNull(),
  // Annotation JSON: [{ kind: 'rect'|'line'|'pen'|'pin', points/coords, color, note? }]
  data: text('data').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),

  documentId: text('document_id').notNull().references(() => document.id, { onDelete: 'cascade' }),
  createdById: text('created_by_id').references(() => user.id, { onDelete: 'set null' }),
}, (t) => [
  index('plan_markup_document_id_idx').on(t.documentId),
])

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
  // What the form asks for and what the reviewer said (migration 0045). Before it these went into `notes` or nowhere.
  submittalType: text('submittal_type').default('product_data').notNull(),
  priority: text('priority').default('normal').notNull(),
  assignedTo: text('assigned_to'),
  reviewNotes: text('review_notes'),
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
  /** Who recorded pass/fail, and when — not the same thing as when it was scheduled. (T32 M1) */
  resultedAt: timestamp('resulted_at'),
  resultedBy: text('resulted_by'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),

  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  projectId: text('project_id').notNull().references(() => project.id, { onDelete: 'cascade' }),
  /**
   * The inspection this one re-does. A pass after a fail used to overwrite the failure in place, so
   * an inspection a building inspector had failed read as if it passed first time. (T32 M1,
   * migration 0031)
   */
  reinspectionOfId: text('reinspection_of_id'),
}, (t) => [
  index('inspection_company_id_idx').on(t.companyId),
  index('inspection_project_id_idx').on(t.projectId),
  index('inspection_reinspection_of_id_idx').on(t.reinspectionOfId),
])

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
  // Who it is for, when they are already a contact. `client` above stays as free text: you bid work
  // for people who are not customers yet. (T32 H6, migration 0030)
  contactId: text('contact_id').references(() => contact.id, { onDelete: 'set null' }),
  // What this bid BECAME. Makes winning-then-converting idempotent — one project per bid.
  projectId: text('project_id').references(() => project.id, { onDelete: 'set null' }),
}, (t) => [
  index('bid_company_id_idx').on(t.companyId),
  index('bid_status_idx').on(t.status),
  index('bid_contact_id_idx').on(t.contactId),
  index('bid_project_id_idx').on(t.projectId),
])

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
  // THE FORM COLLECTS THESE THREE AND THE TABLE HAD NOWHERE TO PUT THEM. (T44)
  //
  // WarrantiesPage.tsx asks for a title (:560), a location (:584) and a priority (:595), and the
  // route refuses a claim with no title — while `title` was being welded onto the front of the
  // description and the other two were silently discarded. The claims list renders {claim.title},
  // so every row's label came back blank and nobody could tell what a claim was about.
  title: text('title'),
  location: text('location'),
  priority: text('priority').default('normal'),
  // HOW THE CUSTOMER GOT IN TOUCH, AND WHO TOOK IT DOWN. (T48)
  //
  // WarrantiesPage.tsx:605 has asked "Reported Via" since the form was written — Phone, Email,
  // Client Portal, In Person — and :517 posts the whole form, so the value was always arriving. The
  // route even adds `reportedBy: user.userId` on top of it and createClaim's signature declares
  // both. The INSERT listed neither, so a shop chose how the customer reached them and the answer
  // went nowhere.
  reportedMethod: text('reported_method'),
  reportedBy: text('reported_by'),
  description: text('description').notNull(),
  resolution: text('resolution'),
  resolvedAt: timestamp('resolved_at'),

  // Every read in the shared warranties module joins project_warranty on this column, and
  // createClaim looks the id up there before inserting it — so this is a project_warranty id and the
  // FK was pointing at the wrong table. While it pointed at the warranty table, EVERY insert
  // violated it and no claim could be filed at all. (T43, confirmed on Contractor and Field service)
  warrantyId: text('warranty_id').notNull().references(() => projectWarranty.id, { onDelete: 'cascade' }),
  projectWarrantyId: text('project_warranty_id'),
  /**
   * THE JOB THIS CLAIM PUT ON THE BOARD. (T51)
   *
   * "Completing a warranty claim leaves its job scheduled."
   *
   * scheduleWarrantyWork() inserts a job for the claim and returned it without ever writing down
   * which job it was, so updateClaimStatus had nothing to close: the claim went to completed and
   * the work order stayed on the dispatch board, assigned, for ever. Anyone reading the board
   * believed the repair was still outstanding.
   */
  jobId: text('job_id').references(() => job.id, { onDelete: 'set null' }),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),

  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('warranty_claim_warranty_id_idx').on(t.warrantyId),
])

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

export const scheduleOfValues = pgTable('schedule_of_values', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id),

  projectId: text('project_id').notNull().unique().references(() => project.id),

  // What the owner names it and who lends against it (migration 0019 — the screen asked for these and they were dropped).
  name: text('name'),
  lenderName: text('lender_name'),
  lenderContact: text('lender_contact'),
  notes: text('notes'),

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
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),

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
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),

  drawRequestId: text('draw_request_id').notNull().references(() => drawRequest.id, { onDelete: 'cascade' }),

  sovLineItemId: text('sov_line_item_id').notNull().references(() => sovLineItem.id),

  completedThisPeriod: decimal('completed_this_period', { precision: 12, scale: 2 }).default('0').notNull(),
  materialsStored: decimal('materials_stored', { precision: 12, scale: 2 }).default('0').notNull(),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('draw_line_item_draw_request_id_idx').on(t.drawRequestId),
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
  /** The quote line this allowance came from (0041): approving a quote opens its allowance lines here, once each. */
  quoteLineItemId: text('quote_line_item_id'),
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

export const aiaForm = pgTable('aia_form', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  projectId: text('project_id').notNull().references(() => project.id, { onDelete: 'cascade' }),
  formType: text('form_type').notNull(), // 'G702' or 'G703'
  applicationNumber: integer('application_number').notNull(),
  periodTo: timestamp('period_to').notNull(),
  contractSum: decimal('contract_sum', { precision: 12, scale: 2 }).notNull(),
  netChangeByChangeOrders: decimal('net_change_by_change_orders', { precision: 12, scale: 2 }).default('0').notNull(),
  contractSumToDate: decimal('contract_sum_to_date', { precision: 12, scale: 2 }).notNull(),
  totalCompletedAndStored: decimal('total_completed_and_stored', { precision: 12, scale: 2 }).notNull(),
  retainagePercent: decimal('retainage_percent', { precision: 5, scale: 2 }).default('10').notNull(),
  retainageAmount: decimal('retainage_amount', { precision: 12, scale: 2 }).notNull(),
  totalEarnedLessRetainage: decimal('total_earned_less_retainage', { precision: 12, scale: 2 }).notNull(),
  lessPreviousCertificates: decimal('less_previous_certificates', { precision: 12, scale: 2 }).default('0').notNull(),
  currentPaymentDue: decimal('current_payment_due', { precision: 12, scale: 2 }).notNull(),
  balanceToFinish: decimal('balance_to_finish', { precision: 12, scale: 2 }).notNull(),
  lineItems: json('line_items').notNull(), // G703 continuation rows
  status: text('status').default('draft').notNull(), // draft, signed, submitted, paid
  signedBy: text('signed_by'),
  signedAt: timestamp('signed_at'),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('aia_form_company_id_idx').on(t.companyId),
  index('aia_form_project_id_idx').on(t.projectId),
])
