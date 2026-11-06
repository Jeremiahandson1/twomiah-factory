// Landscaping add-on: recurring mow routes, area pricing and snow contracts. Column for column from
// templates/crm-landscaping/backend/db/schema.ts.
import { pgTable, text, boolean, integer, decimal, timestamp, index, uniqueIndex, json } from 'drizzle-orm/pg-core'
import { createId } from '@paralleldrive/cuid2'
import { isNull } from 'drizzle-orm'
import { budgetIsActive } from '../../data/indexWhere.ts'
import { company, user } from './core.ts'
import { contact, invoice, invoiceLineItem, job } from './crm.ts'
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
  // How this route's visits are billed: 'per_visit' (a draft invoice when the crew marks the visit complete), 'monthly'
  // (the batch run makes one draft per customer) or 'elsewhere' (an agreement or recurring invoice bills it). NULL = not
  // chosen yet: it reads as 'elsewhere' when a customer on the route has an active agreement or recurring invoice, so
  // nothing already billing bills twice, and as 'monthly' otherwise (data/routeBilling.ts).
  billingMode: text('billing_mode'),
  status: text('status').default('active').notNull(), // active, paused, archived
  notes: text('notes'),
  // The route's season (landscaping parity row 20; Service Autopilot's master schedules): visits are made only between these
  // days (YYYY-MM-DD, both kept), none outside it; when it ends the Route Board offers the next season's renewal. Null: all year.
  seasonStart: text('season_start'),
  seasonEnd: text('season_end'),
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
  // Landscaping parity row 26 (Yardbook "Skip Job Completion Notification"; visit_message_tools): this stop's visits never send the
  // visit-done message.
  skipVisitMessage: boolean('skip_visit_message').default(false).notNull(),
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
  billingMode: text('billing_mode').notNull().default('per_push'), // per_push, per_event, per_inch, seasonal, hourly
  perPushRate: decimal('per_push_rate', { precision: 12, scale: 2 }).default('0').notNull(),
  perEventRate: decimal('per_event_rate', { precision: 12, scale: 2 }).default('0').notNull(),
  perInchRate: decimal('per_inch_rate', { precision: 12, scale: 2 }).default('0').notNull(),
  seasonalRate: decimal('seasonal_rate', { precision: 12, scale: 2 }).default('0').notNull(),
  triggerDepthInches: decimal('trigger_depth_inches', { precision: 5, scale: 2 }).default('2').notNull(),
  saltRate: decimal('salt_rate', { precision: 12, scale: 2 }).default('0').notNull(),
  // The rate an 'hourly' contract is billed by: the crew's hours on site, times this (storm mode's clock, data/snowStorm.ts).
  hourlyRate: decimal('hourly_rate', { precision: 12, scale: 2 }).default('0').notNull(),
  // Landscaping parity rows 22–25 (snow_tools, not ready). depthBands: the 'depth_band' mode's rate table (Aspire) —
  // [{ from, to, amount }] in inches and dollars, `to` null for "and over". requirePhotos: a stop is logged only with a before and
  // an after photo (Service Autopilot). Salt by quantity: saltUnit (tons, bags, lbs, yards) at saltPerUnitRate, or — hourly (time
  // and materials) — our saltUnitCost marked up by materialMarkupPct (Aspire T&M). baseMinutes + minutesPerInch: a stop's
  // expected time scaled by the storm's snowfall (LMN production rates).
  depthBands: json('depth_bands'),
  requirePhotos: boolean('require_photos').default(false).notNull(),
  saltUnit: text('salt_unit'),
  saltPerUnitRate: decimal('salt_per_unit_rate', { precision: 12, scale: 2 }).default('0').notNull(),
  saltUnitCost: decimal('salt_unit_cost', { precision: 12, scale: 2 }).default('0').notNull(),
  materialMarkupPct: decimal('material_markup_pct', { precision: 6, scale: 2 }).default('0').notNull(),
  baseMinutes: integer('base_minutes'),
  minutesPerInch: decimal('minutes_per_inch', { precision: 6, scale: 2 }),
  status: text('status').default('active').notNull(), // active, paused, ended
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('snow_contract_company_id_idx').on(t.companyId),
  index('snow_contract_site_id_idx').on(t.siteId),
  index('snow_contract_status_idx').on(t.status),
])

// One storm: a named run of snow work the office starts, dispatches to every contract on a route or tag, and bills at the
// end (data/snowStorm.ts). The contracts' own rules price every visit; the storm only gathers them.
export const snowStorm = pgTable('snow_storm', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  status: text('status').default('active').notNull(), // active, ended
  // Row 30: 'forecast' when started from the weather forecast (by a tap on its proposal, or on its own where turned on), with the
  // snowfall it expected; the stops' expected time is scaled by it (row 25).
  source: text('source'),
  expectedInches: decimal('expected_inches', { precision: 5, scale: 2 }),
  startedAt: timestamp('started_at').defaultNow().notNull(),
  endedAt: timestamp('ended_at'),
  notes: text('notes'),
  createdById: text('created_by_id').references(() => user.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('snow_storm_company_id_idx').on(t.companyId),
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
  // The crew's hours on site, for an 'hourly' contract (from the stop's Start to the crew logging it, or typed).
  hours: decimal('hours', { precision: 5, scale: 2 }).default('0').notNull(),
  // Salt put down by amount, in the contract's unit (row 24).
  saltQuantity: decimal('salt_quantity', { precision: 10, scale: 2 }),
  // The office's change to what this visit bills, before it is billed (row 23; Aspire): what the contract worked out, the reason,
  // who and when. billableAmount holds the amount billed.
  computedAmount: decimal('computed_amount', { precision: 12, scale: 2 }),
  overrideReason: text('override_reason'),
  overriddenById: text('overridden_by_id').references(() => user.id, { onDelete: 'set null' }),
  overriddenAt: timestamp('overridden_at'),
  // The storm this visit was logged in, if it was logged through storm mode.
  stormId: text('storm_id').references(() => snowStorm.id, { onDelete: 'set null' }),
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

// A contract's place in a storm: one row per contract per storm (unique), carrying the crew's job for it ("Today's route" on
// the phone), the visit they logged, and where it stands. Dispatching a storm twice adds nothing the second time.
export const snowStormStop = pgTable('snow_storm_stop', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  stormId: text('storm_id').notNull().references(() => snowStorm.id, { onDelete: 'cascade' }),
  snowContractId: text('snow_contract_id').notNull().references(() => snowContract.id, { onDelete: 'cascade' }),
  siteId: text('site_id').notNull().references(() => site.id, { onDelete: 'cascade' }),
  jobId: text('job_id').references(() => job.id, { onDelete: 'set null' }),
  eventId: text('event_id').references(() => snowEvent.id, { onDelete: 'set null' }),
  assignedToId: text('assigned_to_id').references(() => user.id, { onDelete: 'set null' }),
  sortOrder: integer('sort_order').default(0).notNull(),
  status: text('status').default('open').notNull(), // open, working, done, skipped
  startedAt: timestamp('started_at'),
  doneAt: timestamp('done_at'),
  note: text('note'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  uniqueIndex('snow_storm_stop_contract_idx').on(t.stormId, t.snowContractId),
  index('snow_storm_stop_company_id_idx').on(t.companyId),
  index('snow_storm_stop_job_id_idx').on(t.jobId),
])

// The message a customer gets when a visit is done (data/visitReports.ts): the crew's note, the after-photos, and what became of
// the message. One row per job, ever (unique job_id), so finishing a job twice never messages the customer twice.
export const visitReport = pgTable('visit_report', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  jobId: text('job_id').notNull().references(() => job.id, { onDelete: 'cascade' }),
  contactId: text('contact_id').references(() => contact.id, { onDelete: 'set null' }),
  // The crew's words for the customer. Customer-visible, unlike the job's own notes.
  note: text('note'),
  // "Do not message the customer about this visit."
  skip: boolean('skip').default(false).notNull(),
  // draft (nothing sent yet), queued (a text waits for its send window), sent, skipped, nothing (no way to reach them), failed
  status: text('status').default('draft').notNull(),
  channel: text('channel'), // text, email
  photoCount: integer('photo_count').default(0).notNull(),
  sendAt: timestamp('send_at'),
  sentAt: timestamp('sent_at'),
  error: text('error'),
  // Row 26 (visit_message_tools): a copy of what the customer got — the subject (email) and the words, as sent.
  messageSubject: text('message_subject'),
  messageText: text('message_text'),
  // Row 31 (Jobber's feedback survey; visit_survey): the customer's 1–5 rating and comment from the message's link.
  rating: integer('rating'),
  ratingComment: text('rating_comment'),
  ratedAt: timestamp('rated_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  uniqueIndex('visit_report_job_idx').on(t.jobId),
  index('visit_report_company_id_idx').on(t.companyId),
  index('visit_report_contact_id_idx').on(t.contactId),
])

// One run of "bill the completed visits" (monthly batch): kept so the whole batch can be undone while its invoices are drafts.
export const routeBillingBatch = pgTable('route_billing_batch', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  fromDate: text('from_date').notNull(), // YYYY-MM-DD, the visits' service days
  toDate: text('to_date').notNull(),
  groupBy: text('group_by').default('none').notNull(), // none, property
  invoiceCount: integer('invoice_count').default(0).notNull(),
  visitCount: integer('visit_count').default(0).notNull(),
  createdById: text('created_by_id').references(() => user.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  undoneAt: timestamp('undone_at'),
}, (t) => [
  index('route_billing_batch_company_id_idx').on(t.companyId),
])

// A route visit's bill. One row per visit, ever (unique job_id): the database's refusal under "never bill a visit twice".
// A deleted invoice takes its rows with it, so those visits are billable again; a voided one is cleared by the billing code.
export const routeVisitInvoice = pgTable('route_visit_invoice', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  jobId: text('job_id').notNull().references(() => job.id, { onDelete: 'cascade' }),
  invoiceId: text('invoice_id').notNull().references(() => invoice.id, { onDelete: 'cascade' }),
  invoiceLineItemId: text('invoice_line_item_id').references(() => invoiceLineItem.id, { onDelete: 'cascade' }),
  batchId: text('batch_id').references(() => routeBillingBatch.id, { onDelete: 'set null' }),
  amount: decimal('amount', { precision: 12, scale: 2 }).default('0').notNull(), // what this visit billed, before tax
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  uniqueIndex('route_visit_invoice_job_idx').on(t.jobId),
  index('route_visit_invoice_invoice_id_idx').on(t.invoiceId),
  index('route_visit_invoice_company_id_idx').on(t.companyId),
])

// A shape drawn on the satellite map for a property (Area Pricing › Measure on the map). `areaType` is the property column
// it adds to — lawnSqft, bedSqft, hardscapeSqft, lotSqft or drivewaySqft — and `mode` says whether it adds to that area or
// cuts out of it (a bed inside a lawn). The area is worked out by the server from the corners; the property's column holds
// the sum of its shapes of that type (data/siteShapes.ts).
export const siteShape = pgTable('site_shape', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  siteId: text('site_id').notNull().references(() => site.id, { onDelete: 'cascade' }),
  areaType: text('area_type').notNull(),
  mode: text('mode').default('add').notNull(), // add, cut
  label: text('label'),
  path: json('path').notNull(), // [[lat, lng], …] in drawing order
  areaSqft: integer('area_sqft').default(0).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('site_shape_site_id_idx').on(t.siteId),
  index('site_shape_company_id_idx').on(t.companyId),
])

// A landscaping business's own switches. One row per company, made the first time one is saved; no row means every switch is at its
// default. `rainDaySkipSundays` (default on): a rain day never lands visits on a Sunday — they go to Monday instead.
export const landscapingSetting = pgTable('landscaping_setting', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  rainDaySkipSundays: boolean('rain_day_skip_sundays').default(true).notNull(),
  // Row 30: start a storm on its own when the forecast's snowfall reaches a contract's trigger. Off unless the owner turns it on.
  snowAutoStart: boolean('snow_auto_start').default(false).notNull(),
  // Row 26 (visit_message_tools): the visit-done message's own words, with {placeholders}; null is the built-in wording. Services
  // (a route stop's service, e.g. "aeration") whose visits are never messaged.
  visitText: text('visit_text'),
  visitEmailSubject: text('visit_email_subject'),
  visitEmailBody: text('visit_email_body'),
  visitSkipServices: json('visit_skip_services').default([]).notNull(),
  // Row 31 (visit_survey): a rating under this emails the office.
  visitAlertBelow: integer('visit_alert_below').default(3).notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  uniqueIndex('landscaping_setting_company_id_idx').on(t.companyId),
])

// One rain day as it was pushed (landscaping parity rows 16 and 29): what moved from where to where, the texts it queued, and
// whether it ran in the background (a big push: Yardbook runs it and emails when done). Kept so the office can UNDO it: each
// visit still where the push put it goes back, and texts not yet sent are cancelled (data/routeRainDay.ts undoRainDay).
export const rainDayRun = pgTable('rain_day_run', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
  status: text('status').default('done').notNull(), // running, done, failed, undone
  fromDate: text('from_date').notNull(),
  toDate: text('to_date'),
  throughDate: text('through_date'),
  shiftDays: integer('shift_days'),
  routeId: text('route_id'),
  moves: json('moves').notNull(), // [{ jobId, number, title, from, to, fromAt, toAt, fromEndAt, toEndAt }]
  textIds: json('text_ids'), // scheduled_text ids it queued
  moved: integer('moved').default(0).notNull(),
  error: text('error'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  finishedAt: timestamp('finished_at'),
  undoneAt: timestamp('undone_at'),
  undoneById: text('undone_by_id').references(() => user.id, { onDelete: 'set null' }),
}, (t) => [
  index('rain_day_run_company_id_idx').on(t.companyId),
])

// "Couldn't do it" on a visit (landscaping parity row 12; LMN crew lead): the crew skipped it with a reason from a list and said
// whether it needs rebooking. The visit is put on hold; the office sees the open ones on the Route Board and rebooks them to a day
// or closes them (data/crewDay.ts). One open skip per visit: a second report from the phone (its queue sends twice) is the same.
export const visitSkip = pgTable('visit_skip', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  jobId: text('job_id').notNull().references(() => job.id, { onDelete: 'cascade' }),
  userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
  reason: text('reason').notNull(), // weather, locked_gate, dog, customer_asked, no_access, equipment, ran_out_of_time, other
  note: text('note'),
  rebook: boolean('rebook').default(true).notNull(),
  skippedAt: timestamp('skipped_at').defaultNow().notNull(),
  resolvedAt: timestamp('resolved_at'),
  resolvedById: text('resolved_by_id').references(() => user.id, { onDelete: 'set null' }),
  resolution: text('resolution'), // rebooked, not_rebooked
  rebookedTo: text('rebooked_to'), // YYYY-MM-DD
}, (t) => [
  index('visit_skip_company_id_idx').on(t.companyId),
  index('visit_skip_job_id_idx').on(t.jobId),
  uniqueIndex('visit_skip_open_idx').on(t.jobId).where(isNull(t.resolvedAt)),
])

// Materials the crew used on a visit (landscaping parity row 13; LMN, Aspire): what, how much, and — from the price book where
// it came from there — what it cost us. Counted in the job's material cost (data/jobCosting.ts). `entryKey` is the phone's
// save id, so a save sent twice by the queue is one line.
export const visitMaterial = pgTable('visit_material', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  jobId: text('job_id').notNull().references(() => job.id, { onDelete: 'cascade' }),
  userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
  pricebookItemId: text('pricebook_item_id'),
  name: text('name').notNull(),
  quantity: decimal('quantity', { precision: 10, scale: 2 }).notNull(),
  unit: text('unit'),
  unitCostCents: integer('unit_cost_cents'),
  entryKey: text('entry_key'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('visit_material_company_id_idx').on(t.companyId),
  index('visit_material_job_id_idx').on(t.jobId),
  uniqueIndex('visit_material_entry_key_idx').on(t.companyId, t.entryKey),
])

// Each crew member's own clock on a visit (landscaping parity row 15; LMN Crew): the crew lead starts and stops each person on the
// visit — a login or a roster member — from the phone, at the moment tapped. Their hours make the visit's actual man-hours, read
// against its budget for the Crew Score (data/crewDay.ts).
export const visitCrewTime = pgTable('visit_crew_time', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  jobId: text('job_id').notNull().references(() => job.id, { onDelete: 'cascade' }),
  userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
  memberId: text('member_id'),
  startedAt: timestamp('started_at').notNull(),
  endedAt: timestamp('ended_at'),
  createdById: text('created_by_id').references(() => user.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('visit_crew_time_company_id_idx').on(t.companyId),
  index('visit_crew_time_job_id_idx').on(t.jobId),
])

// A route saved as a template (landscaping parity row 28; Yardbook's copy route; route_copy, not ready): the route's crew, start time,
// billing mode, season and its stops in order, kept apart from the board so a template never makes visits. "Use" makes a new route
// from it on a chosen day. `stops`: [{ siteId, contactId, serviceType, estimatedMinutes, pricePerVisit, skipVisitMessage }] in order.
export const recurringRouteTemplate = pgTable('recurring_route_template', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  assignedToId: text('assigned_to_id').references(() => user.id, { onDelete: 'set null' }),
  estimatedHours: decimal('estimated_hours', { precision: 5, scale: 2 }).default('0').notNull(),
  startTime: text('start_time').default('08:00').notNull(),
  billingMode: text('billing_mode'),
  seasonStart: text('season_start'),
  seasonEnd: text('season_end'),
  notes: text('notes'),
  stops: json('stops').default([]).notNull(),
  createdById: text('created_by_id').references(() => user.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('recurring_route_template_company_id_idx').on(t.companyId),
])

// The company's operating budget for a year (landscaping parity row 27; LMN's budget → overhead recovery → markup; feature
// company_budget, not ready). `lines`: [{ section, name, amount?, count?, hours?, wage?, prevAmount? }] — section is sales, labor,
// equipment, materials, subs, overhead or overhead_wage. A budget is a draft until activated; the active one for a year is locked
// (change it by copying it to a new draft). The rates come from data/companyBudget.ts and fill the quote form's markup defaults.
export const companyBudget = pgTable('company_budget', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  year: integer('year').notNull(),
  name: text('name').notNull(),
  status: text('status').default('draft').notNull(), // draft, active, archived
  method: text('method').default('mors').notNull(), // mors, flh, sors
  profitPct: decimal('profit_pct', { precision: 6, scale: 2 }).default('10').notNull(),
  laborBurdenPct: decimal('labor_burden_pct', { precision: 6, scale: 2 }).default('0').notNull(),
  overheadBurdenPct: decimal('overhead_burden_pct', { precision: 6, scale: 2 }).default('0').notNull(),
  overtimePct: decimal('overtime_pct', { precision: 6, scale: 2 }).default('0').notNull(),
  overtimeMultiplier: decimal('overtime_multiplier', { precision: 4, scale: 2 }).default('1.5').notNull(),
  unbillablePct: decimal('unbillable_pct', { precision: 6, scale: 2 }).default('0').notNull(),
  // MORS: the overhead recovered on each of these (the rest is recovered on labor).
  materialsMarkupPct: decimal('materials_markup_pct', { precision: 6, scale: 2 }).default('10').notNull(),
  equipmentMarkupPct: decimal('equipment_markup_pct', { precision: 6, scale: 2 }).default('25').notNull(),
  subsMarkupPct: decimal('subs_markup_pct', { precision: 6, scale: 2 }).default('5').notNull(),
  lines: json('lines').default([]).notNull(),
  activatedAt: timestamp('activated_at'),
  activatedById: text('activated_by_id').references(() => user.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('company_budget_company_id_idx').on(t.companyId),
  uniqueIndex('company_budget_active_year_idx').on(t.companyId, t.year).where(budgetIsActive),
])

// A takeoff on an uploaded plan (landscaping parity row 4; Aspire's property takeoffs; feature plan_takeoffs, not ready): the plan file
// (PDF or picture, in storage at fileKey), the page measured, its scale (feet per page width) and the measured items — areas, lengths
// and counts, each a list of points in page-width units ([x, y], 0..1 across). data/planTakeoffs.ts measures them; a takeoff becomes
// quote lines.
export const planTakeoff = pgTable('plan_takeoff', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  siteId: text('site_id').references(() => site.id, { onDelete: 'set null' }),
  contactId: text('contact_id').references(() => contact.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  fileKey: text('file_key').notNull(),
  fileType: text('file_type').notNull(), // application/pdf, image/png, image/jpeg
  fileName: text('file_name'),
  page: integer('page').default(1).notNull(),
  // The page's height ÷ its width, as the screen rendered it (points are in page-width units on both axes).
  pageAspect: decimal('page_aspect', { precision: 8, scale: 5 }),
  feetPerWidth: decimal('feet_per_width', { precision: 14, scale: 4 }),
  items: json('items').default([]).notNull(),
  createdById: text('created_by_id').references(() => user.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('plan_takeoff_company_id_idx').on(t.companyId),
  index('plan_takeoff_site_id_idx').on(t.siteId),
])
