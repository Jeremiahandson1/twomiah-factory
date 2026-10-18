// Salon add-on: the service menu, client profiles and formulas, service records, client accounts and memberships.
// Column for column from templates/crm-salon/backend/db/schema.ts.
import { pgTable, text, boolean, integer, decimal, timestamp, date, json, uniqueIndex, index } from 'drizzle-orm/pg-core'
import { createId } from '@paralleldrive/cuid2'
import { appointment } from './appointments.ts'
import { company, user } from './core.ts'
import { contact, invoice, teamMember } from './crm.ts'

export const clientAccountEntry = pgTable('client_account_entry', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),   // signed: + on account, − spent
  source: text('source').notNull(),                                    // manual/refund_to_account/overpayment/spend/payout
  reason: text('reason').notNull(),                                    // why, in words a person reads back
  createdAt: timestamp('created_at').defaultNow().notNull(),

  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  contactId: text('contact_id').notNull().references(() => contact.id, { onDelete: 'cascade' }),
  invoiceId: text('invoice_id').references(() => invoice.id, { onDelete: 'set null' }),
  createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
}, (t) => [
  index('client_account_entry_client_idx').on(t.companyId, t.contactId),
  index('client_account_entry_invoice_idx').on(t.invoiceId),
])

export const clientProfile = pgTable('client_profile', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  contactId: text('contact_id').notNull().references(() => contact.id, { onDelete: 'cascade' }),
  preferredStylistId: text('preferred_stylist_id').references(() => user.id, { onDelete: 'set null' }),
  hairType: text('hair_type'),
  scalpNotes: text('scalp_notes'),
  allergies: text('allergies'),
  patchTestAt: date('patch_test_at'),
  preferences: text('preferences'),                      // drinks, chat/quiet, parking
  pronouns: text('pronouns'),
  birthday: date('birthday'),                            // birthday offers are a real rebooking lever
  notes: text('notes'),
  /**
   * The formulas this CLIENT is kept on — what a colourist reaches for before they mix anything.
   *
   * A formula used to exist only on a service_record, which hangs off an appointment. That made a
   * colourist's own work hostage to the status of a booking: cancelling a completed visit had to
   * choose between deleting a visit that never happened and destroying the formula written on it.
   * Mangomint does not have that problem because its colour formulas are PINNED CLIENT NOTES — they
   * belong to the person, and a visit is only when one was used.
   *
   * So they live here too. The per-visit record still logs what was mixed on the day, which is real
   * history worth keeping; this is the client's kept set, and it survives anything that happens to a
   * booking. [{ id, label, formula: [{product, shade, parts}], developerVolume, processingMin, note,
   * savedAt, savedFromRecordId, lastUsedAt }]
   */
  formulas: json('formulas').default([]).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
}, (t) => [
  index('client_profile_company_id_idx').on(t.companyId),
  uniqueIndex('client_profile_contact_id_key').on(t.contactId),
])

export const membershipEnrollment = pgTable('membership_enrollment', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  planId: text('plan_id').notNull().references(() => membershipPlan.id, { onDelete: 'cascade' }),
  contactId: text('contact_id').notNull().references(() => contact.id, { onDelete: 'cascade' }),
  status: text('status').default('active').notNull(),    // active/paused/cancelled
  creditsRemaining: integer('credits_remaining'),
  startDate: date('start_date'),
  renewsAt: date('renews_at'),
  // The period this enrolment has already been charged for. Billing CLAIMS a period by moving this
  // forward, so two concurrent runs — or a retry after a half-finished one — can only ever raise one
  // invoice for it. Without it a membership sold as "$99/month" collected nothing at all. (Salon T20 H4)
  lastBilledFor: date('last_billed_for'),
  lastInvoiceId: text('last_invoice_id'),
  cancelledAt: timestamp('cancelled_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
}, (t) => [
  index('membership_enrollment_company_id_idx').on(t.companyId),
  index('membership_enrollment_contact_id_idx').on(t.contactId),
  index('membership_enrollment_renews_at_idx').on(t.renewsAt),
])

// Memberships/packages — the salon read of vet's wellness plan. Either a
// recurring membership or a prepaid block of visits, so creditsTotal is
// nullable (null = unlimited/recurring).
export const membershipPlan = pgTable('membership_plan', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  name: text('name').notNull(),
  description: text('description'),
  price: decimal('price', { precision: 10, scale: 2 }),
  billingCycle: text('billing_cycle').default('monthly').notNull(), // monthly/annual/one_time
  creditsTotal: integer('credits_total'),
  includedServices: json('included_services').default([]).notNull(), // serviceMenu ids
  active: boolean('active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
}, (t) => [
  index('membership_plan_company_id_idx').on(t.companyId),
])

// What the salon sells. rebookIntervalDays is the retention engine's input:
// colour ~42d, cut ~56d, so "due" is computed from the last service record
// rather than stored, which means changing the interval re-times every client.
export const serviceMenu = pgTable('service_menu', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  name: text('name').notNull(),
  category: text('category').default('hair').notNull(),   // hair/colour/nails/skin/massage/waxing/other
  description: text('description'),
  durationMin: integer('duration_min').default(60).notNull(),
  price: decimal('price', { precision: 10, scale: 2 }),
  priceIsFrom: boolean('price_is_from').default(false).notNull(), // "from $250" — colour is rarely fixed
  rebookIntervalDays: integer('rebook_interval_days'),
  requiresPatchTest: boolean('requires_patch_test').default(false).notNull(),
  bookableOnline: boolean('bookable_online').default(false).notNull(),  // offered on the public booking widget (SALON-N4)
  active: boolean('active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
}, (t) => [
  index('service_menu_company_id_idx').on(t.companyId),
])

// The formula log — the salon's equivalent of the clinical record, and the
// reason a client cannot casually leave. Also what makes "due for rebooking"
// computable, via serviceId -> serviceMenu.rebookIntervalDays.
export const serviceRecord = pgTable('service_record', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  contactId: text('contact_id').notNull().references(() => contact.id, { onDelete: 'cascade' }),
  appointmentId: text('appointment_id').references(() => appointment.id, { onDelete: 'set null' }),
  stylistId: text('stylist_id').references(() => user.id, { onDelete: 'set null' }),
  // Same reason as on `appointment`: the person who did the work may be roster-only. (Salon T20 H1)
  stylistMemberId: text('stylist_member_id').references(() => teamMember.id, { onDelete: 'set null' }),
  serviceId: text('service_id').references(() => serviceMenu.id, { onDelete: 'set null' }),
  // The sale this visit raised. Logging a service creates an invoice, and deleting the visit used to
  // leave that invoice standing — Open, full balance, still counted in Outstanding, with nothing on it
  // connecting it back to the record that had been deleted. A visit logged without an appointment had
  // no link at all. (Salon T20 H3)
  invoiceId: text('invoice_id'),
  performedAt: timestamp('performed_at').defaultNow().notNull(),
  formula: json('formula').default([]).notNull(),        // [{product, shade, parts}] — repeatable next visit
  developerVolume: text('developer_volume'),
  processingMin: integer('processing_min'),
  productsUsed: text('products_used'),
  result: text('result'),
  photoBefore: text('photo_before'),
  photoAfter: text('photo_after'),
  priceCharged: decimal('price_charged', { precision: 10, scale: 2 }),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
}, (t) => [
  index('service_record_company_id_idx').on(t.companyId),
  index('service_record_contact_id_idx').on(t.contactId),
  index('service_record_performed_idx').on(t.performedAt),
  // One visit record per appointment, for the same reason as the invoice above: six simultaneous
  // completions wrote three, and the client's visit count, last-visit date and rebooking history
  // were all inflated by the difference. A visit logged without an appointment carries NULL here and
  // is unaffected. (LY0928 H1)
  uniqueIndex('service_record_appointment_unique').on(t.companyId, t.appointmentId),
])
