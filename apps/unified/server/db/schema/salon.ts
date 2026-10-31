// Salon add-on: the service menu, client profiles and formulas, service records, client accounts and memberships.
// Column for column from templates/crm-salon/backend/db/schema.ts.
import { pgTable, text, boolean, integer, decimal, timestamp, date, json, uniqueIndex, index } from 'drizzle-orm/pg-core'
import { createId } from '@paralleldrive/cuid2'
import { appointment } from './appointments.ts'
import { company, user } from './core.ts'
import { contact, invoice, invoiceLineItem, teamMember } from './crm.ts'

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
  /** 'passed' | 'failed'. Null with a date = recorded before results were kept: counts as passed. */
  patchTestResult: text('patch_test_result'),
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
  /**
   * Charge the client's card on file when a period's invoice is raised (Card on File on). Off by default, so every
   * existing enrolment keeps raising an open invoice exactly as before. Turned on only with the client's agreement,
   * recorded below; turned off by the salon at any time, and by the app itself after the last failed try.
   */
  autoCharge: boolean('auto_charge').default(false).notNull(),
  autoChargeConsentAt: timestamp('auto_charge_consent_at'),
  autoChargeConsentUserId: text('auto_charge_consent_user_id').references(() => user.id, { onDelete: 'set null' }),
  /** Paused because the card was declined on every try (status 'paused' too): no credits while unpaid. Resuming clears it. */
  pausedForPaymentAt: timestamp('paused_for_payment_at'),
  /** The private link in the member's email that opens Stripe's card page for a new card (/membership/card/<token>); cleared on resume. */
  cardUpdateToken: text('card_update_token'),
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
  /** Processing time (colour): the stylist is free for `processingMin` minutes starting `processingAfterMin` minutes in. Null = hands-on throughout. */
  processingAfterMin: integer('processing_after_min'),
  processingMin: integer('processing_min'),
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

// ── Card on file (gap #1) ─────────────────────────────────────────────────────────────────────────────────────────────
// Every card here lives on the SALON'S OWN Stripe account (the Connect account it linked in Settings › Integrations);
// nothing is held or charged on Twomiah's. Only Stripe's ids and the card's brand/last four are kept — never a number.

/** A card a client gave the salon to keep on file, saved on Stripe's own page. Removed = the salon or client took it off. */
export const clientCard = pgTable('client_card', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  contactId: text('contact_id').notNull().references(() => contact.id, { onDelete: 'cascade' }),
  /** The salon's connected account the customer and card belong to: a card is only ever charged on this one. */
  stripeAccount: text('stripe_account').notNull(),
  stripeCustomerId: text('stripe_customer_id').notNull(),
  paymentMethodId: text('payment_method_id').notNull(),
  brand: text('brand'),
  last4: text('last4'),
  expMonth: integer('exp_month'),
  expYear: integer('exp_year'),
  /** Consent: when it was given, the policy words the client agreed to as they stood then, and how it was given. */
  consentAt: timestamp('consent_at').notNull(),
  consentText: text('consent_text').notNull(),
  /** 'client_online' (ticked on the booking form) | 'staff_at_desk' (the client agreed in person; the seat that recorded it is below). */
  consentVia: text('consent_via').notNull(),
  consentUserId: text('consent_user_id').references(() => user.id, { onDelete: 'set null' }),
  removedAt: timestamp('removed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('client_card_client_idx').on(t.companyId, t.contactId),
  uniqueIndex('client_card_payment_method_key').on(t.companyId, t.paymentMethodId),
])

/** The salon's card policy: one row per salon. Fees are a flat amount OR a percent of the service price, never both. */
export const cardPolicy = pgTable('card_policy', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  /** Who must leave a card to book online: 'off' | 'new_clients' | 'all'. */
  cardRequirement: text('card_requirement').default('off').notNull(),
  noShowFeeAmount: decimal('no_show_fee_amount', { precision: 10, scale: 2 }),
  noShowFeePercent: integer('no_show_fee_percent'),
  /** Cancelling inside this many minutes of the start is a late cancel. Null = no late-cancel fee. */
  lateCancelWindowMinutes: integer('late_cancel_window_minutes'),
  lateCancelFeeAmount: decimal('late_cancel_fee_amount', { precision: 10, scale: 2 }),
  lateCancelFeePercent: integer('late_cancel_fee_percent'),
  /** The salon's own words, shown at booking, in the confirmation and on the card page. Null = the standard sentence. */
  policyText: text('policy_text'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  uniqueIndex('card_policy_company_id_key').on(t.companyId),
])

/** Each time the salon charged (or tried to charge) a no-show or late-cancel fee: the ledger, with the reason and the receipt. */
export const cardFeeCharge = pgTable('card_fee_charge', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  contactId: text('contact_id').notNull().references(() => contact.id, { onDelete: 'cascade' }),
  appointmentId: text('appointment_id').references(() => appointment.id, { onDelete: 'set null' }),
  cardId: text('card_id').references(() => clientCard.id, { onDelete: 'set null' }),
  /** 'no_show' | 'late_cancel' */
  kind: text('kind').notNull(),
  amount: decimal('amount', { precision: 10, scale: 2 }).notNull(),
  /** 'succeeded' | 'declined' | 'needs_action' */
  status: text('status').notNull(),
  /** Why, in the words of the person who charged it: kept with the charge. */
  reason: text('reason').notNull(),
  paymentIntentId: text('payment_intent_id'),
  failureMessage: text('failure_message'),
  chargedByUserId: text('charged_by_user_id').references(() => user.id, { onDelete: 'set null' }),
  receiptSentAt: timestamp('receipt_sent_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('card_fee_charge_company_idx').on(t.companyId, t.createdAt),
  index('card_fee_charge_appointment_idx').on(t.appointmentId),
  index('card_fee_charge_contact_idx').on(t.contactId),
])

/**
 * Every try at charging a membership period's invoice to the client's card: one row per try, claimed BEFORE Stripe is
 * asked (unique per invoice and try number), so two runs cannot both charge, and a try that died half-way is resumed
 * under the same number — and so the same Stripe idempotency key — instead of charging twice.
 */
export const membershipCharge = pgTable('membership_charge', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  enrollmentId: text('enrollment_id').notNull().references(() => membershipEnrollment.id, { onDelete: 'cascade' }),
  invoiceId: text('invoice_id').notNull().references(() => invoice.id, { onDelete: 'cascade' }),
  contactId: text('contact_id').notNull().references(() => contact.id, { onDelete: 'cascade' }),
  cardId: text('card_id').references(() => clientCard.id, { onDelete: 'set null' }),
  /** The period (renewal day) the invoice is for. */
  period: date('period').notNull(),
  attempt: integer('attempt').notNull(),
  amount: decimal('amount', { precision: 10, scale: 2 }).notNull(),
  /** 'pending' (claimed, Stripe not answered) | 'succeeded' | 'declined' | 'needs_action' */
  status: text('status').notNull(),
  paymentIntentId: text('payment_intent_id'),
  failureMessage: text('failure_message'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  uniqueIndex('membership_charge_invoice_attempt_idx').on(t.invoiceId, t.attempt),
  index('membership_charge_company_id_idx').on(t.companyId),
  index('membership_charge_enrollment_id_idx').on(t.enrollmentId),
])


/**
 * One service of a visit that has several (salon "multi-service visits"): in order, each with its own stylist, its place in
 * the visit (minutes from its start), length, processing gap and price. A visit without rows is the plain one-service appointment.
 */
export const appointmentItem = pgTable('appointment_item', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  appointmentId: text('appointment_id').notNull().references(() => appointment.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  serviceId: text('service_id').references(() => serviceMenu.id, { onDelete: 'set null' }),
  stylistId: text('stylist_id').references(() => user.id, { onDelete: 'set null' }),
  stylistMemberId: text('stylist_member_id').references(() => teamMember.id, { onDelete: 'set null' }),
  /** Minutes from the visit's start to this service's start. */
  startOffsetMin: integer('start_offset_min').notNull(),
  durationMin: integer('duration_min').notNull(),
  processingAfterMin: integer('processing_after_min'),
  processingMin: integer('processing_min'),
  price: decimal('price', { precision: 10, scale: 2 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('appointment_item_appointment_id_idx').on(t.appointmentId),
  index('appointment_item_stylist_idx').on(t.companyId, t.stylistId),
])

/** A preset kind of blocked time the owner keeps (salon parity row 2; Fresha's blocked time types): a name, a colour, a usual length, paid or not. */
export const bookBlockType = pgTable('book_block_type', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  /** A hex colour the Book draws the block in. */
  color: text('color').default('#94a3b8').notNull(),
  defaultMin: integer('default_min').default(60).notNull(),
  /** Paid time off the chair (training, a meeting) counts toward hours; unpaid (lunch) does not. */
  paid: boolean('paid').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  uniqueIndex('book_block_type_company_name_idx').on(t.companyId, t.name),
])

/** Time a chair is not bookable (lunch, training): one stylist's, or the whole salon's when no stylist is named. */
export const bookBlock = pgTable('book_block', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  stylistId: text('stylist_id').references(() => user.id, { onDelete: 'cascade' }),
  stylistMemberId: text('stylist_member_id').references(() => teamMember.id, { onDelete: 'cascade' }),
  startTime: timestamp('start_time').notNull(),
  endTime: timestamp('end_time').notNull(),
  reason: text('reason'),
  /** The type it was made from, if any. Deleting the type leaves the block as it was: the name, colour and paid mark are kept on the block. */
  typeId: text('type_id').references(() => bookBlockType.id, { onDelete: 'set null' }),
  typeName: text('type_name'),
  typeColor: text('type_color'),
  paid: boolean('paid'),
  /** Blocks made together by one repeat rule share a series, so the whole series can be changed or removed. */
  seriesId: text('series_id'),
  createdBy: text('created_by'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('book_block_company_start_idx').on(t.companyId, t.startTime),
  index('book_block_series_idx').on(t.companyId, t.seriesId),
])

/**
 * A form the salon asks its clients to fill in before a visit (salon "intake and consent forms"; feature `intake_forms`): questions of
 * its own, or a consent to tick and sign by typing a name. Offered on the booking's page for the services it names (none named = every
 * online booking). A response is kept as it was asked — the form may change after.
 */
export const intakeForm = pgTable('intake_form', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  /** 'intake' (questions) or 'consent' (an agreement the client ticks and signs by typing their name). */
  kind: text('kind').default('intake').notNull(),
  intro: text('intro'),
  /** [{ id, label, type: 'text' | 'longtext' | 'yesno' | 'choice' | 'consent', required, options? }] */
  questions: json('questions').$type<any[]>().default([]).notNull(),
  /** Service Menu ids the form applies to; empty = every online booking. */
  serviceIds: json('service_ids').$type<string[]>().default([]).notNull(),
  active: boolean('active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('intake_form_company_idx').on(t.companyId),
])

/** A client's answers to a form, on their chart. */
export const intakeResponse = pgTable('intake_response', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  formId: text('form_id').references(() => intakeForm.id, { onDelete: 'set null' }),
  /** The form's name as it was when answered. */
  formName: text('form_name').notNull(),
  formKind: text('form_kind').default('intake').notNull(),
  contactId: text('contact_id').notNull().references(() => contact.id, { onDelete: 'cascade' }),
  /** The online booking it was answered for (its token), when it was. */
  bookingToken: text('booking_token'),
  /** [{ label, type, answer }] — as asked, so a later change to the form never rewrites what a client said. */
  answers: json('answers').$type<any[]>().default([]).notNull(),
  signedName: text('signed_name'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('intake_response_contact_idx').on(t.companyId, t.contactId),
  uniqueIndex('intake_response_once_idx').on(t.formId, t.contactId, t.bookingToken),
])

/**
 * What the salon's automatic retention sends (feature `retention_sends`) did, one row per client per event: a rebooking on its due date,
 * a birthday (that year), a win-back (that lapse), a "book your next visit" prompt (that visit), a follow-up sequence started. The unique
 * key is what makes a pass safe to run any number of times — the second look finds the row and sends nothing.
 */
export const retentionSend = pgTable('retention_send', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  contactId: text('contact_id').notNull().references(() => contact.id, { onDelete: 'cascade' }),
  /** 'rebook' | 'birthday' | 'win_back' | 'next_visit' | 'drip_visit_completed' | 'drip_lapsed' */
  kind: text('kind').notNull(),
  /** What this send is for: the due date and category, the year, the last visit's date, the appointment. */
  eventKey: text('event_key').notNull(),
  /** 'sms' | 'email' | 'drip' | null when nothing could be sent. */
  channel: text('channel'),
  /** 'sent' | 'skipped' | 'failed' */
  status: text('status').notNull(),
  /** Why it was skipped or failed, in words. */
  reason: text('reason'),
  message: text('message'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  uniqueIndex('retention_send_once').on(t.companyId, t.contactId, t.kind, t.eventKey),
  index('retention_send_company_created_idx').on(t.companyId, t.createdAt),
])

/**
 * A gift card the salon sold at the desk (salon gap #10; hidden feature `salon_gift_cards`). Not the bar's card (bar_gift_card):
 * the money in and out is the salon's own sale and payments — the card is only a balance the salon owes back. `invoiceId` is
 * the sale that paid for it (one card per sale). Every change to `balanceCents` has a ledger row; a voided card holds nothing.
 * `code` is read aloud and typed (Crockford letters, no look-alikes); it is never printed on an invoice.
 */
export const salonGiftCard = pgTable('salon_gift_card', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  code: text('code').notNull(),
  initialCents: integer('initial_cents').notNull(),
  balanceCents: integer('balance_cents').notNull(),
  /** 'active' | 'void' */
  status: text('status').notNull().default('active'),
  invoiceId: text('invoice_id').references(() => invoice.id, { onDelete: 'set null' }),
  purchaserContactId: text('purchaser_contact_id').references(() => contact.id, { onDelete: 'set null' }),
  purchaserName: text('purchaser_name'),
  purchaserEmail: text('purchaser_email'),
  recipientName: text('recipient_name'),
  recipientEmail: text('recipient_email'),
  message: text('message'),
  soldByName: text('sold_by_name'),
  voidedAt: timestamp('voided_at'),
  voidReason: text('void_reason'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  uniqueIndex('salon_gift_card_company_code_key').on(t.companyId, t.code),
  uniqueIndex('salon_gift_card_company_invoice_key').on(t.companyId, t.invoiceId),
])

/** Every change to a card's balance: issue (+), redeem (−), refund (+), adjust (±), void (−). Never edited. */
export const salonGiftCardLedger = pgTable('salon_gift_card_ledger', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  cardId: text('card_id').notNull().references(() => salonGiftCard.id, { onDelete: 'cascade' }),
  amountCents: integer('amount_cents').notNull(),
  /** 'issue' | 'redeem' | 'refund' | 'adjust' | 'void' */
  kind: text('kind').notNull(),
  /** The sale it was spent on / put back from (redeem, refund) — or that sold the card (issue). */
  invoiceId: text('invoice_id'),
  byName: text('by_name'),
  note: text('note'),
  at: timestamp('at').defaultNow().notNull(),
}, (t) => [
  index('salon_gift_card_ledger_card_idx').on(t.cardId, t.at),
  index('salon_gift_card_ledger_invoice_idx').on(t.companyId, t.invoiceId),
])

// ─── Checkout at the chair (salon gap #7) ────────────────────────────────────────────────────────────────────────

/** A Stripe card reader paired to the salon's OWN connected Stripe account (server-driven Terminal). Simulated readers are for testing. */
export const salonReader = pgTable('salon_reader', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  stripeReaderId: text('stripe_reader_id').notNull(),
  /** The connected account the reader belongs to: a reader is only ever used on this one. */
  stripeAccount: text('stripe_account').notNull(),
  locationId: text('location_id').notNull(),
  label: text('label').notNull(),
  deviceType: text('device_type'),
  serialNumber: text('serial_number'),
  createdByName: text('created_by_name'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  uniqueIndex('salon_reader_company_reader_key').on(t.companyId, t.stripeReaderId),
])

/**
 * One card payment sent to a reader for a sale. `pending` until Stripe says the PaymentIntent succeeded (then the sale's payment is
 * written ONCE, with the tip) or the reader's action failed / was cancelled / ran out of time. The tip asked for at the desk is added to
 * the PaymentIntent (amountCents + tipCents) and recorded as the payment's tip.
 */
export const salonTerminalCharge = pgTable('salon_terminal_charge', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  invoiceId: text('invoice_id').notNull().references(() => invoice.id, { onDelete: 'cascade' }),
  readerId: text('reader_id').notNull().references(() => salonReader.id, { onDelete: 'cascade' }),
  stripeAccount: text('stripe_account').notNull(),
  paymentIntentId: text('payment_intent_id').notNull(),
  /** What goes on the sale, in cents (without the tip). */
  amountCents: integer('amount_cents').notNull(),
  /** The tip, in cents: what the desk asked for, then what Stripe says was received above the amount. */
  tipCents: integer('tip_cents').notNull().default(0),
  /** 'pending' | 'succeeded' | 'failed' | 'canceled' | 'timed_out' */
  status: text('status').notNull().default('pending'),
  failure: text('failure'),
  paymentId: text('payment_id'),
  startedById: text('started_by_id'),
  startedByName: text('started_by_name'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  uniqueIndex('salon_terminal_charge_pi_key').on(t.companyId, t.paymentIntentId),
  index('salon_terminal_charge_invoice_idx').on(t.invoiceId),
])

/** A retail product the salon sells off the shelf. Stock on hand is NOT stored: it is what came in less what sits on sales that stand (salonStockMove, salonRetailSale). */
export const salonRetailProduct = pgTable('salon_retail_product', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  brand: text('brand'),
  sku: text('sku'),
  priceCents: integer('price_cents').notNull(),
  costCents: integer('cost_cents'),
  /** On hand at or below this = low. Null = never flagged. */
  reorderAt: integer('reorder_at'),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('salon_retail_product_company_idx').on(t.companyId, t.active),
])

/** Stock in (+) and corrections (±) with who and why. Sales are not moves: they are salonRetailSale rows, so a void sale gives its stock back by itself. */
export const salonStockMove = pgTable('salon_stock_move', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  productId: text('product_id').notNull().references(() => salonRetailProduct.id, { onDelete: 'cascade' }),
  quantity: integer('quantity').notNull(),
  /** 'received' | 'adjust' */
  kind: text('kind').notNull(),
  note: text('note'),
  byName: text('by_name'),
  at: timestamp('at').defaultNow().notNull(),
}, (t) => [
  index('salon_stock_move_product_idx').on(t.productId),
])

/** A retail product on a sale: the invoice line it is (type 'retail') and how many. Removing the line, or voiding the sale, returns the stock. */
export const salonRetailSale = pgTable('salon_retail_sale', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  productId: text('product_id').notNull().references(() => salonRetailProduct.id, { onDelete: 'cascade' }),
  invoiceId: text('invoice_id').notNull().references(() => invoice.id, { onDelete: 'cascade' }),
  lineItemId: text('line_item_id').notNull().references(() => invoiceLineItem.id, { onDelete: 'cascade' }),
  quantity: integer('quantity').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  uniqueIndex('salon_retail_sale_line_key').on(t.lineItemId),
  index('salon_retail_sale_product_idx').on(t.productId),
  index('salon_retail_sale_invoice_idx').on(t.invoiceId),
])
