// Private-events add-on (restaurants, venues and bars): enquiries and bookings, spaces, menus and packages, deposits
// and the banquet event order's timeline. Column for column from templates/crm-{restaurant,bar}/backend/db/schema.ts.
import { pgTable, text, boolean, integer, decimal, timestamp, date, json, index } from 'drizzle-orm/pg-core'
import { createId } from '@paralleldrive/cuid2'
import { company, user } from './core.ts'
import { contact } from './crm.ts'

// The booking. status IS the sales pipeline — enquiry -> tentative -> confirmed
// -> completed, with lost/cancelled as the exits, so one table serves both the
// calendar and the funnel report.
export const event = pgTable('event', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  contactId: text('contact_id').references(() => contact.id, { onDelete: 'set null' }),
  spaceId: text('space_id').references(() => eventSpace.id, { onDelete: 'set null' }),
  coordinatorId: text('coordinator_id').references(() => user.id, { onDelete: 'set null' }),
  name: text('name').notNull(),                            // "Harper / Diaz wedding"
  eventType: text('event_type').default('private_dining').notNull(), // wedding/corporate/birthday/funeral/private_dining/other
  status: text('status').default('enquiry').notNull(),     // enquiry/tentative/confirmed/completed/lost/cancelled
  eventDate: date('event_date').notNull(),
  startTime: text('start_time'),                           // "18:30" — a room booking is a time of day, not an instant
  endTime: text('end_time'),
  guestCount: integer('guest_count'),
  guestCountFinal: integer('guest_count_final'),           // the guaranteed number, locked days before
  quotedTotal: decimal('quoted_total', { precision: 10, scale: 2 }),
  depositRequired: decimal('deposit_required', { precision: 10, scale: 2 }),
  source: text('source'),                                  // where the enquiry came from
  lostReason: text('lost_reason'),                         // why it didn't close — the only way to learn
  dietaryRequirements: text('dietary_requirements'),
  setupNotes: text('setup_notes'),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
}, (t) => [
  index('event_company_id_idx').on(t.companyId),
  index('event_contact_id_idx').on(t.contactId),
  index('event_date_idx').on(t.eventDate),
  index('event_status_idx').on(t.status),
])

// What they're eating and drinking. Priced per head or as a flat line so bar
// tabs, cake-cutting fees and room hire live alongside the food packages.
export const eventMenuItem = pgTable('event_menu_item', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  eventId: text('event_id').notNull().references(() => event.id, { onDelete: 'cascade' }),
  packageId: text('package_id').references(() => menuPackage.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  perPerson: boolean('per_person').default(true).notNull(),
  quantity: integer('quantity').default(1).notNull(),      // heads when perPerson, else units
  unitPrice: decimal('unit_price', { precision: 10, scale: 2 }),
  notes: text('notes'),
  // Set only on the room-hire line added from a space's hire fee, so it can be replaced when the
  // event moves rooms. Hand-typed lines leave it null.
  spaceId: text('space_id').references(() => eventSpace.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
}, (t) => [
  index('event_menu_item_company_id_idx').on(t.companyId),
  index('event_menu_item_event_id_idx').on(t.eventId),
])

// Deposit + balance SCHEDULE: what is due, and when. The money itself lives on the event's invoice
// (invoice.eventId) — an installment is paid when the invoice has collected enough to cover it and
// every earlier one. paidAt/method/reference are legacy: written before the ledger moved onto
// invoices, read once by the backfill, never written again.
export const eventPayment = pgTable('event_payment', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  eventId: text('event_id').notNull().references(() => event.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),                          // "Deposit", "Final balance"
  amount: decimal('amount', { precision: 10, scale: 2 }).notNull(),
  dueDate: date('due_date'),
  paidAt: timestamp('paid_at'),
  method: text('method'),
  reference: text('reference'),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
}, (t) => [
  index('event_payment_company_id_idx').on(t.companyId),
  index('event_payment_event_id_idx').on(t.eventId),
  index('event_payment_due_idx').on(t.dueDate),
])

// The rooms you can sell. minimumSpend is what the sales conversation actually
// turns on — a Saturday night room is sold on spend, not on hourly rate.
export const eventSpace = pgTable('event_space', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  name: text('name').notNull(),
  description: text('description'),
  seatedCapacity: integer('seated_capacity'),
  standingCapacity: integer('standing_capacity'),
  minimumSpend: decimal('minimum_spend', { precision: 10, scale: 2 }),
  hireFee: decimal('hire_fee', { precision: 10, scale: 2 }),
  amenities: json('amenities').default([]).notNull(),   // AV, dance floor, private bar, patio
  photo: text('photo'),
  active: boolean('active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
}, (t) => [
  index('event_space_company_id_idx').on(t.companyId),
])

// The banquet event order: the minute-by-minute run of show. This is the sheet
// the kitchen and the floor actually work from on the night, and the reason a
// handover between coordinator and chef stops being a conversation.
export const eventTimeline = pgTable('event_timeline', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  eventId: text('event_id').notNull().references(() => event.id, { onDelete: 'cascade' }),
  time: text('time').notNull(),                            // "18:30"
  title: text('title').notNull(),                          // "Guests arrive — canapes + prosecco"
  department: text('department').default('floor').notNull(), // floor/kitchen/bar/av/setup
  details: text('details'),
  sortOrder: integer('sort_order').default(0).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
}, (t) => [
  index('event_timeline_company_id_idx').on(t.companyId),
  index('event_timeline_event_id_idx').on(t.eventId),
])

// Catering packages priced PER HEAD, which is how every banquet quote is built.
// minGuests is enforced when the event is quoted, so an undersized booking
// can't silently undercut the package economics.
export const menuPackage = pgTable('menu_package', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  name: text('name').notNull(),
  description: text('description'),
  category: text('category').default('dinner').notNull(),  // canape/lunch/dinner/buffet/bar/dessert/other
  pricePerPerson: decimal('price_per_person', { precision: 10, scale: 2 }),
  minGuests: integer('min_guests'),
  courses: json('courses').default([]).notNull(),          // [{course, options:[...]}]
  dietaryNotes: text('dietary_notes'),
  active: boolean('active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
}, (t) => [
  index('menu_package_company_id_idx').on(t.companyId),
])
