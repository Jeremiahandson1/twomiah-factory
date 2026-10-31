// Private-events add-on (restaurants, venues and bars): enquiries and bookings, spaces, menus and packages, deposits
// and the banquet event order's timeline. Column for column from templates/crm-{restaurant,bar}/backend/db/schema.ts.
import { pgTable, text, boolean, integer, decimal, timestamp, date, json, index, uniqueIndex } from 'drizzle-orm/pg-core'
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
  // The guarantee cutoff (restaurant-bar-depth #5): after it the count is locked; a manager can override with a reason.
  guaranteeOverrideReason: text('guarantee_override_reason'),
  guaranteeOverriddenAt: timestamp('guarantee_overridden_at'),
  guaranteeOverriddenBy: text('guarantee_overridden_by'),
  guaranteeReminderSentAt: timestamp('guarantee_reminder_sent_at'),
  // When the booking first became a booking (confirmed): the lead-source and year-on-year reports count by it (#7).
  bookedAt: timestamp('booked_at'),
  quotedTotal: decimal('quoted_total', { precision: 10, scale: 2 }),
  depositRequired: decimal('deposit_required', { precision: 10, scale: 2 }),
  source: text('source'),                                  // where the enquiry came from
  // The website-form campaign the enquiry came in through (restaurant-bar parity #4); its source was copied to `source`.
  campaignId: text('campaign_id').references(() => eventFormCampaign.id, { onDelete: 'set null' }),
  // A hold (a tentative event) can lapse (restaurant-bar parity #5): the last day it is kept, a reminder before, and when it was let go.
  holdUntil: date('hold_until'),
  holdReminderSentAt: timestamp('hold_reminder_sent_at'),
  holdReleasedAt: timestamp('hold_released_at'),
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
  // The pay link (/pay/<token>) of this instalment, minted when it is first needed (restaurant-bar-depth #2).
  payToken: text('pay_token'),
  // Reminders sent, once each: before the due date, on it, and after it.
  reminderBeforeAt: timestamp('reminder_before_at'),
  reminderDueAt: timestamp('reminder_due_at'),
  reminderOverdueAt: timestamp('reminder_overdue_at'),
  // The card-on-file charge on the due date: tried once a day at most, and what came of it.
  autopayAttemptedAt: timestamp('autopay_attempted_at'),
  autopayStatus: text('autopay_status'),                   // succeeded / failed / processing (a bank debit that has not settled yet)
  autopayError: text('autopay_error'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
}, (t) => [
  index('event_payment_company_id_idx').on(t.companyId),
  index('event_payment_pay_token_idx').on(t.payToken),
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
  // The secret of this room's calendar feed (/api/event-feed/<token>.ics), for Google, Apple and Outlook (#4).
  feedToken: text('feed_token'),
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

// A room's food-and-beverage minimum for a kind of day (restaurant-bar-depth #6): by day of the week and by season, and
// optionally for one menu category. The most specific rule that fits the event's date wins; the room's single
// minimumSpend is the fallback.
export const eventSpaceMinimum = pgTable('event_space_minimum', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  spaceId: text('space_id').notNull().references(() => eventSpace.id, { onDelete: 'cascade' }),
  label: text('label'),                                    // "Saturdays in wedding season"
  daysOfWeek: json('days_of_week').default([]).notNull(),  // [0..6], Sunday = 0; empty = every day
  seasonStart: text('season_start'),                       // "05-01" (month-day); empty = all year
  seasonEnd: text('season_end'),                           // "10-31"; a season may wrap the new year
  category: text('category'),                              // a menu package category; empty = all food and beverage
  amount: decimal('amount', { precision: 10, scale: 2 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
}, (t) => [
  index('event_space_minimum_space_idx').on(t.spaceId),
  index('event_space_minimum_company_id_idx').on(t.companyId),
])

// Someone waiting for a room on a date that is held (#4). When the hold is let go, the first waiting guest is offered it.
export const eventWaitlist = pgTable('event_waitlist', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  spaceId: text('space_id').notNull().references(() => eventSpace.id, { onDelete: 'cascade' }),
  eventDate: date('event_date').notNull(),
  startTime: text('start_time'),
  endTime: text('end_time'),
  contactId: text('contact_id').references(() => contact.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  email: text('email'),
  phone: text('phone'),
  guestCount: integer('guest_count'),
  notes: text('notes'),
  status: text('status').default('waiting').notNull(),     // waiting / offered / booked / removed
  offeredAt: timestamp('offered_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
}, (t) => [
  index('event_waitlist_company_id_idx').on(t.companyId),
  index('event_waitlist_space_date_idx').on(t.spaceId, t.eventDate),
])

// The proposal a guest reads, chooses on and signs (#1): frozen when it is sent, so what they signed is what they saw.
export const eventProposal = pgTable('event_proposal', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  eventId: text('event_id').notNull().references(() => event.id, { onDelete: 'cascade' }),
  version: integer('version').default(1).notNull(),
  status: text('status').default('draft').notNull(),       // draft / sent / viewed / accepted / declined / expired / superseded
  publicToken: text('public_token'),                       // the guest's private link, minted when it is sent
  message: text('message'),                                // the coordinator's note to the guest
  terms: text('terms'),                                    // the venue's terms, as sent
  options: json('options').default([]).notNull(),          // [{id,title,kind:'single'|'multi',required,choices:[{id,label,perPerson,price}]}]
  snapshot: json('snapshot').default({}).notNull(),        // the event as sent: room, date, times, guests, lines, minimum, schedule
  selections: json('selections').default({}).notNull(),    // { optionId: [choiceId] } as the guest chose
  expiresAt: timestamp('expires_at'),
  sentAt: timestamp('sent_at'),
  viewedAt: timestamp('viewed_at'),
  acceptedAt: timestamp('accepted_at'),
  declinedAt: timestamp('declined_at'),
  declineReason: text('decline_reason'),
  // Signing evidence — the same set the quote keeps (tenant-backend invoicing/signingEvidence.ts).
  signature: text('signature'),
  signedBy: text('signed_by'),
  signedAt: timestamp('signed_at'),
  signedIp: text('signed_ip'),
  signedUserAgent: text('signed_user_agent'),
  signatureHash: text('signature_hash'),
  consentAt: timestamp('consent_at'),
  // Contract and signers (restaurant-bar parity #1): the venue's contract template chosen for this event, frozen as sent; the
  // signers drafted in their send order (each becomes an event_proposal_signer row when it is sent).
  contractTemplateId: text('contract_template_id'),
  contractName: text('contract_name'),
  contractBody: text('contract_body'),
  signerPlan: json('signer_plan').default([]).notNull(),   // [{role:'client'|'client_second'|'venue', name, email}] in send order
  createdBy: text('created_by'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
}, (t) => [
  index('event_proposal_company_id_idx').on(t.companyId),
  index('event_proposal_event_id_idx').on(t.eventId),
  index('event_proposal_public_token_idx').on(t.publicToken),
])

// The card a client left for an event's instalments, on the venue's OWN Stripe account (#2). The card number never
// reaches us: Stripe keeps it; we keep the ids to charge it and the last four to show.
export const eventAutopay = pgTable('event_autopay', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  eventId: text('event_id').notNull().references(() => event.id, { onDelete: 'cascade' }),
  contactId: text('contact_id').references(() => contact.id, { onDelete: 'set null' }),
  stripeAccount: text('stripe_account').notNull(),
  stripeCustomerId: text('stripe_customer_id').notNull(),
  paymentMethodId: text('payment_method_id'),
  setupIntentId: text('setup_intent_id'),
  brand: text('brand'),
  last4: text('last4'),
  method: text('method').default('card').notNull(),        // card / us_bank_account — what the saved payment method is
  setupMethod: text('setup_method'),                       // what a setup in progress will save (a bank account is verified over days)
  status: text('status').default('pending').notNull(),     // pending (card not saved yet) / active / stopped
  consentAt: timestamp('consent_at'),
  consentIp: text('consent_ip'),
  consentText: text('consent_text'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
}, (t) => [
  index('event_autopay_company_id_idx').on(t.companyId),
  index('event_autopay_event_id_idx').on(t.eventId),
])

// A contract the venue writes once and chooses per event (#1): text with {{merge fields}} the proposal fills from the event
// (client, date, room, head count, menu, totals, deposit schedule, guarantee and minimum terms).
export const eventContractTemplate = pgTable('event_contract_template', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  name: text('name').notNull(),                            // "Wedding contract"
  body: text('body').notNull(),
  isDefault: boolean('is_default').default(false).notNull(), // used when an event's proposal names none
  active: boolean('active').default(true).notNull(),
  createdBy: text('created_by'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
}, (t) => [
  index('event_contract_template_company_id_idx').on(t.companyId),
])

// One person who signs a proposal, in the venue's send order (#1): the client, a second client signer, the venue's own
// countersignature. Each keeps the same evidence a quote keeps — the drawn signature, the typed name, the consent words and
// the moment — and has a private link; the next signer's link goes out when the one before signs.
export const eventProposalSigner = pgTable('event_proposal_signer', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  proposalId: text('proposal_id').notNull().references(() => eventProposal.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),                 // 1 = first to sign
  role: text('role').notNull(),                            // client / client_second / venue
  name: text('name'),                                      // who the venue invited
  email: text('email').notNull(),
  token: text('token').notNull(),                          // the signer's private link
  status: text('status').default('waiting').notNull(),     // waiting (not their turn) / sent / signed
  sentAt: timestamp('sent_at'),
  signature: text('signature'),
  signedBy: text('signed_by'),
  signedAt: timestamp('signed_at'),
  signedIp: text('signed_ip'),
  signedUserAgent: text('signed_user_agent'),
  signatureHash: text('signature_hash'),
  consentAt: timestamp('consent_at'),
  consentText: text('consent_text'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
}, (t) => [
  uniqueIndex('event_proposal_signer_position_idx').on(t.proposalId, t.position),
  index('event_proposal_signer_token_idx').on(t.token),
  index('event_proposal_signer_company_id_idx').on(t.companyId),
])

// A client's payment from a US bank account (ACH) toward one instalment (restaurant-bar parity #3). A bank debit is not paid when
// the client confirms it: it is processing for up to four business days and then succeeds or comes back failed. This row follows
// that on the venue's own Stripe account; the instalment is recorded on the invoice only when it succeeds, never before.
export const eventBankPayment = pgTable('event_bank_payment', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  eventId: text('event_id').notNull().references(() => event.id, { onDelete: 'cascade' }),
  eventPaymentId: text('event_payment_id').notNull().references(() => eventPayment.id, { onDelete: 'cascade' }),
  invoiceId: text('invoice_id').notNull(),
  paymentIntentId: text('payment_intent_id').notNull(),
  stripeAccount: text('stripe_account').notNull(),
  amountCents: integer('amount_cents').notNull(),
  source: text('source').notNull(),                        // pay_link / proposal_page / autopay
  status: text('status').default('awaiting').notNull(),    // awaiting (client has not finished) / requires_action (verify the bank) / processing / succeeded / failed / canceled
  keepForAutopay: boolean('keep_for_autopay').default(false).notNull(), // the client asked to keep this account for the later payments
  consentAt: timestamp('consent_at'),
  consentIp: text('consent_ip'),
  consentText: text('consent_text'),
  bankName: text('bank_name'),
  last4: text('last4'),
  verifyUrl: text('verify_url'),                           // Stripe's page where the client verifies the micro-deposits
  failureCode: text('failure_code'),
  failureMessage: text('failure_message'),
  initiatedAt: timestamp('initiated_at'),
  settledAt: timestamp('settled_at'),
  failedAt: timestamp('failed_at'),
  noticeSentAt: timestamp('notice_sent_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
}, (t) => [
  uniqueIndex('event_bank_payment_intent_idx').on(t.paymentIntentId),
  index('event_bank_payment_event_payment_idx').on(t.eventPaymentId),
  index('event_bank_payment_company_id_idx').on(t.companyId),
])

// A website-form campaign (restaurant-bar parity #4; Tripleseat's lead form per campaign): one embeddable form, one link, that tags
// every enquiry it brings in with the same lead source (a list entry from eventSources.ts), so the source report counts it.
export const eventFormCampaign = pgTable('event_form_campaign', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  name: text('name').notNull(),                            // "Instagram bio link", "The Knot listing"
  token: text('token').notNull(),                          // in the form's address; not a secret, it only opens an enquiry form
  source: text('source').notNull(),                        // an id from EVENT_SOURCES
  active: boolean('active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
}, (t) => [
  uniqueIndex('event_form_campaign_token_idx').on(t.token),
  index('event_form_campaign_company_id_idx').on(t.companyId),
])

// What the venue spent advertising to one lead source in one month (restaurant-bar parity #6): the source report divides it by the
// enquiries and the bookings that source brought, and sets the value booked against it. In integer cents, one row per source and month.
export const eventMarketingSpend = pgTable('event_marketing_spend', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  source: text('source').notNull(),                        // an id from EVENT_SOURCES
  month: text('month').notNull(),                          // "2026-10": the month on the venue's clock
  amountCents: integer('amount_cents').notNull(),
  note: text('note'),
  updatedBy: text('updated_by'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
}, (t) => [
  uniqueIndex('event_marketing_spend_once_idx').on(t.companyId, t.source, t.month),
])

// A report emailed on a schedule to chosen seats (restaurant-bar parity #6). Weekly goes on a weekday and covers the seven days before;
// monthly goes on a day of the month (1-28) and covers the month before. What was sent for which day is kept in reminder_log.
export const eventReportSchedule = pgTable('event_report_schedule', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  report: text('report').notNull(),                        // sources / years
  frequency: text('frequency').notNull(),                  // weekly / monthly
  weekday: integer('weekday'),                             // 0 Sunday .. 6 Saturday, for weekly
  monthDay: integer('month_day'),                          // 1 .. 28, for monthly
  recipients: json('recipients').$type<string[]>().default([]).notNull(), // user ids
  active: boolean('active').default(true).notNull(),
  createdBy: text('created_by'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
}, (t) => [
  index('event_report_schedule_company_id_idx').on(t.companyId),
])
