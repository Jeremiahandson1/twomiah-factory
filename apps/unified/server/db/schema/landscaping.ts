// Landscaping add-on: recurring mow routes, area pricing and snow contracts. Column for column from
// templates/crm-landscaping/backend/db/schema.ts.
import { pgTable, text, boolean, integer, decimal, timestamp, index } from 'drizzle-orm/pg-core'
import { createId } from '@paralleldrive/cuid2'
import { company, user } from './core.ts'
import { contact, invoice } from './crm.ts'
import { site } from './trades.ts'

// A named per-weekday crew route (e.g. "Monday Route A").
export const recurringRoute = pgTable('recurring_route', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  dayOfWeek: integer('day_of_week').notNull(), // 0=Sun .. 6=Sat
  assignedToId: text('assigned_to_id').references(() => user.id, { onDelete: 'set null' }),
  estimatedHours: decimal('estimated_hours', { precision: 5, scale: 2 }).default('0').notNull(),
  // When the crew leaves the yard, 'HH:MM'. The first stop starts here; each next stop starts when the one before is
  // done, so the stop order IS the day's order on the Schedule, Crew View and the phone.
  startTime: text('start_time').default('08:00').notNull(),
  status: text('status').default('active').notNull(), // active, paused, archived
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('recurring_route_company_id_idx').on(t.companyId),
  index('recurring_route_day_of_week_idx').on(t.dayOfWeek),
])

// A stop on a route — a recurring service at a site, in visit order.
export const recurringRouteStop = pgTable('recurring_route_stop', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  recurringRouteId: text('recurring_route_id').notNull().references(() => recurringRoute.id, { onDelete: 'cascade' }),
  siteId: text('site_id').notNull().references(() => site.id, { onDelete: 'cascade' }),
  contactId: text('contact_id').references(() => contact.id, { onDelete: 'set null' }),
  serviceType: text('service_type').default('mowing').notNull(),
  sortOrder: integer('sort_order').default(0).notNull(),
  estimatedMinutes: integer('estimated_minutes').default(30).notNull(),
  pricePerVisit: decimal('price_per_visit', { precision: 12, scale: 2 }).default('0').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('recurring_route_stop_route_id_idx').on(t.recurringRouteId),
  index('recurring_route_stop_company_id_idx').on(t.companyId),
])

// Per-company rate card. Price = max(minCharge, areaSqft / 1000 * ratePer1000Sqft).
export const serviceRate = pgTable('service_rate', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  serviceType: text('service_type').notNull(), // mowing, mulch_install, fertilization, aeration, leaf_cleanup, pressure_wash
  areaField: text('area_field').notNull().default('lawnSqft'), // which site.*Sqft column drives the price
  ratePer1000Sqft: decimal('rate_per_1000_sqft', { precision: 12, scale: 2 }).notNull(),
  minCharge: decimal('min_charge', { precision: 12, scale: 2 }).default('0').notNull(),
  unitLabel: text('unit_label').default('per visit'),
  active: boolean('active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('service_rate_company_id_idx').on(t.companyId),
  index('service_rate_service_type_idx').on(t.serviceType),
])

// Per-site snow billing arrangement.
export const snowContract = pgTable('snow_contract', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  siteId: text('site_id').notNull().references(() => site.id, { onDelete: 'cascade' }),
  contactId: text('contact_id').references(() => contact.id, { onDelete: 'set null' }),
  billingMode: text('billing_mode').notNull().default('per_push'), // per_push, per_event, per_inch, seasonal
  perPushRate: decimal('per_push_rate', { precision: 12, scale: 2 }).default('0').notNull(),
  perEventRate: decimal('per_event_rate', { precision: 12, scale: 2 }).default('0').notNull(),
  perInchRate: decimal('per_inch_rate', { precision: 12, scale: 2 }).default('0').notNull(),
  seasonalRate: decimal('seasonal_rate', { precision: 12, scale: 2 }).default('0').notNull(),
  triggerDepthInches: decimal('trigger_depth_inches', { precision: 5, scale: 2 }).default('2').notNull(),
  saltRate: decimal('salt_rate', { precision: 12, scale: 2 }).default('0').notNull(),
  status: text('status').default('active').notNull(), // active, paused, ended
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('snow_contract_company_id_idx').on(t.companyId),
  index('snow_contract_site_id_idx').on(t.siteId),
  index('snow_contract_status_idx').on(t.status),
])

// One logged plow/salt visit. billableAmount is computed from the contract's billing mode at log time.
export const snowEvent = pgTable('snow_event', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  snowContractId: text('snow_contract_id').notNull().references(() => snowContract.id, { onDelete: 'cascade' }),
  siteId: text('site_id').notNull().references(() => site.id, { onDelete: 'cascade' }),
  servicedAt: timestamp('serviced_at').defaultNow().notNull(),
  pushes: integer('pushes').default(1).notNull(),
  snowfallInches: decimal('snowfall_inches', { precision: 5, scale: 2 }).default('0').notNull(),
  saltApplied: boolean('salt_applied').default(false).notNull(),
  /**
   * "Charge this one even though it was below the trigger depth." (T58d)
   *
   * The contract's trigger_depth_inches decides whether a plough pass is billable; this records the
   * exception, because a push below trigger is a real and chargeable thing when the customer asks
   * for it. Default false: nobody made that decision on a row that predates the flag.
   */
  billBelowTrigger: boolean('bill_below_trigger').default(false).notNull(),
  billableAmount: decimal('billable_amount', { precision: 12, scale: 2 }).default('0').notNull(),
  billingMode: text('billing_mode').notNull(), // snapshot of mode used
  invoiceId: text('invoice_id').references(() => invoice.id, { onDelete: 'set null' }),
  assignedToId: text('assigned_to_id').references(() => user.id, { onDelete: 'set null' }),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('snow_event_company_id_idx').on(t.companyId),
  index('snow_event_contract_id_idx').on(t.snowContractId),
  index('snow_event_serviced_at_idx').on(t.servicedAt),
])
