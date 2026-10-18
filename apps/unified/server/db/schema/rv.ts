// Dealership add-on (RV, powersports): units, sales leads, repair orders, rentals, the parts catalogue and
// service-to-sales alerts. Column for column from templates/crm-rv/backend/db/schema.ts.
import { pgTable, text, boolean, integer, decimal, timestamp, date, json, uniqueIndex, index } from 'drizzle-orm/pg-core'
import { createId } from '@paralleldrive/cuid2'
import { company, user } from './core.ts'
import { contact, invoice } from './crm.ts'

// Parts catalog the dealer brings themselves — OEM price files they download from
// their dealer portal, or their existing parts export migrated off the old DMS.
// This powers the Parts Catalog with ZERO OEM/vendor pre-approval (the dealer owns
// this data). A licensed feed (Snap-on EPC / ARI) can layer on later without changing
// the table or the UI. Distinct from inventory_item (what's physically stocked).
export const catalogPart = pgTable('catalog_part', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  partNumber: text('part_number').notNull(),
  name: text('name').notNull(),
  oem: text('oem').default('').notNull(),
  category: text('category').default('Parts').notNull(),
  price: decimal('price', { precision: 10, scale: 2 }).default('0').notNull(),
  cost: decimal('cost', { precision: 10, scale: 2 }),
  msrp: decimal('msrp', { precision: 10, scale: 2 }),
  availability: text('availability').default('Order from OEM').notNull(),
  supersededBy: text('superseded_by'),
  fitment: text('fitment'),
  diagram: text('diagram'),
  source: text('source').default('import').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
}, (t) => [
  uniqueIndex('catalog_part_company_pn_oem_key').on(t.companyId, t.partNumber, t.oem),
  index('catalog_part_company_oem_idx').on(t.companyId, t.oem),
])

export const rentalReservation = pgTable('rental_reservation', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  unitLabel: text('unit_label').notNull(),
  customerName: text('customer_name').notNull(),
  startDate: date('start_date').notNull(),
  endDate: date('end_date').notNull(),
  days: integer('days').notNull(),
  dailyRate: decimal('daily_rate', { precision: 10, scale: 2 }).notNull(),
  total: decimal('total', { precision: 12, scale: 2 }).notNull(),
  status: text('status').default('reserved').notNull(), // reserved, out, returned, cancelled
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),

  unitId: text('unit_id').references(() => unit.id, { onDelete: 'set null' }),
  contactId: text('contact_id').references(() => contact.id, { onDelete: 'set null' }),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
}, (t) => [
  index('rental_reservation_company_id_idx').on(t.companyId),
  index('rental_reservation_unit_id_start_date_idx').on(t.unitId, t.startDate),
])

export const repairOrder = pgTable('repair_order', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  roNumber: text('ro_number'),
  writeUpDate: timestamp('write_up_date').defaultNow().notNull(),
  status: text('status').default('open').notNull(), // open, in_progress, waiting_parts, ready, closed
  customerUnitInfo: json('customer_unit_info'), // { vin, year, make, model, mileage, hours } for units not in inventory
  services: json('services').default([]).notNull(), // [{ description, laborHours, partsCost, laborCost }]
  advisorName: text('advisor_name'),
  estimatedTotal: decimal('estimated_total', { precision: 10, scale: 2 }),
  actualTotal: decimal('actual_total', { precision: 10, scale: 2 }),
  notes: text('notes'),
  completedAt: timestamp('completed_at'),
  invoiceId: text('invoice_id').references(() => invoice.id, { onDelete: 'set null' }), // set when the RO is closed → billed
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),

  customerId: text('customer_id').notNull().references(() => contact.id, { onDelete: 'cascade' }),
  unitId: text('unit_id').references(() => unit.id, { onDelete: 'set null' }),
  technicianId: text('technician_id').references(() => user.id, { onDelete: 'set null' }),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
}, (t) => [
  index('repair_order_company_id_idx').on(t.companyId),
  index('repair_order_status_idx').on(t.status),
  index('repair_order_customer_id_idx').on(t.customerId),
  uniqueIndex('repair_order_ro_number_company_id_key').on(t.roNumber, t.companyId),
])

export const salesLead = pgTable('sales_lead', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  source: text('source'), // adf_xml, walk_in, web, phone, referral, lead_inbox
  stage: text('stage').default('new').notNull(), // new, contacted, demo, desking, closed_won, closed_lost
  notes: text('notes'),
  tradeInInfo: json('trade_in_info'), // { year, make, model, vin, value }
  deal: json('deal'), // desked deal inputs — Desking saves, F&I reads (PUT /api/sales-leads/:id/deal)
  followUpDate: timestamp('follow_up_date'),
  closedAt: timestamp('closed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),

  contactId: text('contact_id').notNull().references(() => contact.id, { onDelete: 'cascade' }),
  unitId: text('unit_id').references(() => unit.id, { onDelete: 'set null' }),
  assignedTo: text('assigned_to').references(() => user.id, { onDelete: 'set null' }),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
}, (t) => [
  index('sales_lead_company_id_idx').on(t.companyId),
  index('sales_lead_stage_idx').on(t.stage),
  index('sales_lead_assigned_to_idx').on(t.assignedTo),
  index('sales_lead_contact_id_idx').on(t.contactId),
])

export const serviceSalesAlert = pgTable('service_sales_alert', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  alertMessage: text('alert_message'),
  alertedAt: timestamp('alerted_at').defaultNow().notNull(),
  dismissedAt: timestamp('dismissed_at'),
  convertedToLead: boolean('converted_to_lead').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),

  repairOrderId: text('repair_order_id').notNull().references(() => repairOrder.id, { onDelete: 'cascade' }),
  salesLeadId: text('sales_lead_id').references(() => salesLead.id, { onDelete: 'set null' }),
  salespersonId: text('salesperson_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  customerId: text('customer_id').notNull().references(() => contact.id, { onDelete: 'cascade' }),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
}, (t) => [
  index('service_sales_alert_company_id_idx').on(t.companyId),
  index('service_sales_alert_salesperson_id_idx').on(t.salespersonId),
  index('service_sales_alert_dismissed_at_idx').on(t.dismissedAt),
])

export const unit = pgTable('unit', {
  id: text('id').primaryKey().$defaultFn(() => createId()),

  // --- Identity ---
  // category: motorhome | towable | motorcycle | atv | utv | sxs | pwc | snowmobile | boat
  category: text('category').notNull(),
  condition: text('condition').default('new').notNull(), // new, used, consignment
  stockNumber: text('stock_number'),
  vin: text('vin'), // VIN (motorized) or serial number (towables / powersports)
  year: integer('year'),
  make: text('make'), // OEM / brand (Winnebago, Forest River, Polaris, Yamaha, Sea-Doo…)
  modelName: text('model_name'),
  trim: text('trim'), // floorplan code (RV) or trim/edition (powersports)
  status: text('status').default('available').notNull(), // available, sold, pending, on_order, in_service

  // --- Pricing ---
  msrp: decimal('msrp', { precision: 10, scale: 2 }),
  listedPrice: decimal('listed_price', { precision: 10, scale: 2 }),
  internetPrice: decimal('internet_price', { precision: 10, scale: 2 }),
  cost: decimal('cost', { precision: 10, scale: 2 }),

  // --- Media / descriptive ---
  photos: json('photos').default([]).notNull(),
  floorplanImg: text('floorplan_img'), // RV floorplan diagram
  description: text('description'),
  features: json('features').default([]).notNull(),
  exteriorColor: text('exterior_color'),
  interiorColor: text('interior_color'),

  // --- RV-specific ---
  rvClass: text('rv_class'), // A, B, B+, C, super_c (motorhomes only)
  towableType: text('towable_type'), // travel_trailer, fifth_wheel, toy_hauler, pop_up, teardrop, destination
  lengthFt: decimal('length_ft', { precision: 5, scale: 1 }),
  sleeps: integer('sleeps'),
  slideOuts: integer('slide_outs'),
  gvwr: integer('gvwr'), // gross vehicle weight rating (lbs)
  dryWeight: integer('dry_weight'), // unloaded vehicle weight (lbs)
  hitchWeight: integer('hitch_weight'), // tongue / pin weight (lbs, towables)
  chassis: text('chassis'), // Ford F53, Freightliner, Mercedes Sprinter…
  freshTankGal: integer('fresh_tank_gal'),
  greyTankGal: integer('grey_tank_gal'),
  blackTankGal: integer('black_tank_gal'),
  generatorHours: integer('generator_hours'),
  awnings: integer('awnings'),

  // --- Motorized / powersports mechanical ---
  fuelType: text('fuel_type'), // gas, diesel, propane, electric
  engine: text('engine'), // engine / chassis engine description
  engineCc: integer('engine_cc'), // powersports displacement
  mileage: integer('mileage'), // motorhomes
  hours: integer('hours'), // powersports / generator usage hours
  transmission: text('transmission'),
  drivetrain: text('drivetrain'), // 2wd/4wd (UTV), etc.

  // --- Marine / boat-specific (category 'boat') ---
  hin: text('hin'), // Hull Identification Number — boats use HIN, not VIN
  beamFt: decimal('beam_ft', { precision: 5, scale: 1 }), // width
  draftFt: decimal('draft_ft', { precision: 5, scale: 1 }),
  hullMaterial: text('hull_material'), // fiberglass, aluminum, wood, inflatable, composite
  engineType: text('engine_type'), // outboard, inboard, sterndrive, jet, none
  engineCount: integer('engine_count'),
  engineHp: integer('engine_hp'), // total horsepower
  fuelCapacityGal: integer('fuel_capacity_gal'),
  maxPersons: integer('max_persons'), // USCG rated capacity
  trailerIncluded: boolean('trailer_included'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),

  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
}, (t) => [
  index('unit_company_id_idx').on(t.companyId),
  index('unit_status_idx').on(t.status),
  index('unit_category_idx').on(t.category),
  index('unit_make_idx').on(t.make),
  uniqueIndex('unit_vin_company_id_key').on(t.vin, t.companyId),
])
