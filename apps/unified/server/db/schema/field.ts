// Field layer (SPEC §4.5): GPS and geofences, inventory and purchasing, the pricebook, service agreements, equipment,
// the fleet and roof reports. Column for column the base CRM's tables (templates/crm/backend/db/schema.ts), so a
// tenant's rows move across unchanged.
import { type AnyPgColumn, pgTable, text, boolean, integer, decimal, real, timestamp, json, uniqueIndex, index } from 'drizzle-orm/pg-core'
import { createId } from '@paralleldrive/cuid2'
import { company, user } from './core.ts'
import { contact, job, project } from './crm.ts'

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
  /** The branch (location table) this stock location belongs to — a warehouse or truck at one branch. */
  branchId: text('branch_id'),
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
  locationId: text('location_id').references(() => inventoryLocation.id, { onDelete: 'set null' }),
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

export const pricebookCategory = pgTable('pricebook_category', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  name: text('name').notNull(),
  description: text('description'),
  sortOrder: integer('sort_order').default(0).notNull(),
  active: boolean('active').default(true).notNull(),

  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  parentId: text('parent_id').references((): AnyPgColumn => pricebookCategory.id, { onDelete: 'set null' }),

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
  imageUrl: text('image_url'),
  customerDescription: text('customer_description'),
  laborHours: decimal('labor_hours', { precision: 8, scale: 2 }),
  showToCustomer: boolean('show_to_customer').default(true).notNull(),
  partsIncluded: text('parts_included'),

  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  categoryId: text('category_id').references(() => pricebookCategory.id),
  inventoryItemId: text('inventory_item_id').references(() => inventoryItem.id),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('pricebook_item_company_id_idx').on(t.companyId),
  index('pricebook_item_category_id_idx').on(t.categoryId),
])

export const serviceAgreement = pgTable('service_agreement', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  number: text('number').notNull(),
  name: text('name').notNull(),
  status: text('status').default('active').notNull(),
  startDate: timestamp('start_date').notNull(),
  endDate: timestamp('end_date'),
  renewalType: text('renewal_type').default('auto').notNull(),
  autopay: boolean('autopay').default(false).notNull(),
  paymentMethodId: text('payment_method_id'),
  lastBilledAt: timestamp('last_billed_at'),
  nextBillDate: timestamp('next_bill_date'),
  autopayLastError: text('autopay_last_error'),
  renewalNoticeSentFor: timestamp('renewal_notice_sent_for'), // the end date the last renewal notice was sent for
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
  // Whose asset this is. The form has always offered a Customer and posted contactId; this template
  // had no column for it, so the link was dropped on every save. (T32 H9, migration 0029)
  contactId: text('contact_id').references(() => contact.id, { onDelete: 'set null' }),

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

export const pricebookGoodBetterBest = pgTable('pricebook_good_better_best', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  pricebookItemId: text('pricebook_item_id').notNull().references(() => pricebookItem.id, { onDelete: 'cascade' }),
  tier: text('tier').notNull(),
  name: text('name'),
  description: text('description'),
  price: decimal('price', { precision: 12, scale: 2 }).notNull(),
  features: json('features'),
  recommended: boolean('recommended').default(false).notNull(),
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

export const roofReport = pgTable('roof_report', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  contactId: text('contact_id').references(() => contact.id, { onDelete: 'set null' }),

  address: text('address').notNull(),
  city: text('city').notNull(),
  state: text('state').notNull(),
  zip: text('zip').notNull(),
  lat: real('lat').notNull(),
  lng: real('lng').notNull(),
  formattedAddress: text('formatted_address'),

  totalAreaSqft: real('total_area_sqft').notNull(),
  totalSquares: real('total_squares').notNull(),
  segmentCount: integer('segment_count').notNull(),
  imageryQuality: text('imagery_quality').notNull(),
  imageryDate: text('imagery_date'),
  aerialImagePath: text('aerial_image_path'),
  roofMaskPath: text('roof_mask_path'),

  segments: json('segments').notNull(),
  edges: json('edges').notNull(),
  measurements: json('measurements').notNull(),
  rawSolarData: json('raw_solar_data'),

  userEdited: boolean('user_edited').default(false).notNull(),
  originalEdges: json('original_edges'),
  originalMeasurements: json('original_measurements'),

  status: text('status').default('paid').notNull(),
  stripePaymentIntentId: text('stripe_payment_intent_id'),
  amountCharged: decimal('amount_charged', { precision: 10, scale: 2 }).default('9.99'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('roof_report_company_id_idx').on(t.companyId),
  index('roof_report_contact_id_idx').on(t.contactId),
])
