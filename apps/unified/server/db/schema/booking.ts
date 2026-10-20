// Bookings layer (SPEC §4.3): one booking engine for every business. The data model is the premium site's
// (templates/website-premium-*/db/schema.ts): services with buffers and their own slot grid, opening hours per team
// member with several windows a day, days off, service ZIP zones, recurring series, a waitlist, bans and outbound
// webhooks. Conformed to the rulebook: singular names, company_id on every row, the standard id, timestamps without a
// zone holding UTC, json not text-json, and money as numeric dollars like the CRM. From the CRMs' shared engine
// (packages/tenant-backend/src/booking): the shop's own time zone in the database, the notice and booking window,
// the 'pending' status for a booking whose deposit is unpaid, and the deposit-hold lifecycle.
//
// The booking is the record (SPEC §4.7): it links to the contact it created or matched, and a CRM job is made FROM
// a booking (job.booking_id, step 3) — never a second copy kept in step.
//
// Dropped as dead: the site's zone centre/radius (stored, never read), its "unique partial index" (promised in a
// comment, never created — the engine serialises with a lock instead), and the copy fields its admin edited but its
// table never had (they are real columns here).
import { pgTable, text, integer, boolean, numeric, timestamp, json, index, uniqueIndex } from 'drizzle-orm/pg-core'
import { createId } from '@paralleldrive/cuid2'
import { company, user } from './core.ts'
import { contact } from './crm.ts'
import { appointment } from './appointments.ts'

const money = (name: string) => numeric(name, { precision: 12, scale: 2 })

/** How the business takes bookings: one row per company. */
export const bookingSettings = pgTable('booking_settings', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  enabled: boolean('enabled').default(true).notNull(),
  /** IANA zone every hour, day off and slot is read in. */
  timezone: text('timezone').default('America/Chicago').notNull(),
  /** The least notice a booking needs, in minutes (0 = right up to the slot). */
  leadTimeMinutes: integer('lead_time_minutes').default(60).notNull(),
  /** How far ahead customers may book; day N is the last bookable day. */
  maxDaysOut: integer('max_days_out').default(30).notNull(),
  /** Travel between two jobs for the same person, on top of each service's own buffers. */
  driveTimeMinutes: integer('drive_time_minutes').default(0).notNull(),
  /** Customers can't reschedule or cancel themselves inside this many minutes of the start. */
  selfServiceCutoffMinutes: integer('self_service_cutoff_minutes').default(60).notNull(),
  /** Minutes an unpaid deposit holds its slot before it is released. */
  depositHoldMinutes: integer('deposit_hold_minutes').default(30).notNull(),
  /** Ask for the address the work happens at. Null: the vertical's own answer. */
  requireAddress: boolean('require_address'),
  requirePhone: boolean('require_phone').default(true).notNull(),
  /** The owner hears of each new booking by email / text. */
  notifyEmail: boolean('notify_email').default(true).notNull(),
  notifySms: boolean('notify_sms').default(false).notNull(),
  // The words on the public booking pages and the confirmation (null = the defaults).
  heroTitle: text('hero_title'),
  heroSubtitle: text('hero_subtitle'),
  confirmCta: text('confirm_cta'),
  thanksMessage: text('thanks_message'),
  confirmationEmailSubject: text('confirmation_email_subject'),
  confirmationEmailIntro: text('confirmation_email_intro'),
  /** Where a review request sends a happy customer (the business's Google review link). */
  reviewLink: text('review_link'),
  /** The private address of the business's bookings calendar feed; rotating it cuts off old subscribers. */
  icalFeedToken: text('ical_feed_token'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  uniqueIndex('booking_settings_company_id_key').on(t.companyId),
])

/** What customers can book. */
export const bookingService = pgTable('booking_service', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  /** Its address on the site: /book/<slug>. */
  slug: text('slug').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  durationMinutes: integer('duration_minutes').notNull(),
  price: money('price'),
  /** A deposit to book: a fixed amount, or a percent of the price (one or the other). */
  depositAmount: money('deposit_amount'),
  depositPercent: integer('deposit_percent'),
  bufferBeforeMinutes: integer('buffer_before_minutes').default(0).notNull(),
  bufferAfterMinutes: integer('buffer_after_minutes').default(0).notNull(),
  /** Start times step by this many minutes. */
  slotStepMinutes: integer('slot_step_minutes').default(30).notNull(),
  /** How many customers one time can take (a class, a tour); 1 = one at a time. */
  capacity: integer('capacity').default(1).notNull(),
  /** Tip choices offered at booking, in percent (e.g. [15, 20, 25]); null = no tip prompt. */
  tipPresets: json('tip_presets'),
  /** Days after a completed visit to ask "ready for the next one?"; null = never. */
  rebookIntervalDays: integer('rebook_interval_days'),
  active: boolean('active').default(true).notNull(),
  sortOrder: integer('sort_order').default(0).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  uniqueIndex('booking_service_company_id_slug_key').on(t.companyId, t.slug),
])

/** Weekly opening hours. user_id null = anyone (a business that doesn't book by person); several windows a day. */
export const bookingHours = pgTable('booking_hours', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
  /** 0 = Sunday … 6 = Saturday. */
  dayOfWeek: integer('day_of_week').notNull(),
  /** Minutes from midnight, in the business's zone. */
  startMinute: integer('start_minute').notNull(),
  endMinute: integer('end_minute').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('booking_hours_company_id_day_of_week_idx').on(t.companyId, t.dayOfWeek),
])

/** A day or part of a day nobody (user_id null) or one person can be booked: holidays, time off. */
export const bookingBlackout = pgTable('booking_blackout', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
  /** YYYY-MM-DD in the business's zone. */
  date: text('date').notNull(),
  /** Both null = the whole day. */
  startMinute: integer('start_minute'),
  endMinute: integer('end_minute'),
  reason: text('reason'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('booking_blackout_company_id_date_idx').on(t.companyId, t.date),
])

/** The ZIP codes one person serves. Someone with no zone serves everywhere. */
export const bookingZone = pgTable('booking_zone', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  /** ['53593', '53711', …] */
  zips: json('zips').default([]).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('booking_zone_company_id_idx').on(t.companyId),
])

/** A repeating booking — "every other Tuesday at 10, eight times". Each visit is a booking row pointing here. */
export const bookingSeries = pgTable('booking_series', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  serviceId: text('service_id').notNull().references(() => bookingService.id, { onDelete: 'restrict' }),
  contactId: text('contact_id').references(() => contact.id, { onDelete: 'set null' }),
  /** 'weekly' | 'monthly' — every `interval_count` weeks or months ("every other week" is weekly × 2). */
  frequency: text('frequency').notNull(),
  intervalCount: integer('interval_count').default(1).notNull(),
  /** The first visit's start; later visits keep its wall-clock time in the business's zone. */
  firstStartAt: timestamp('first_start_at').notNull(),
  /** Stops at whichever comes first. */
  occurrencesCount: integer('occurrences_count'),
  untilDate: text('until_date'),
  customerName: text('customer_name').notNull(),
  customerEmail: text('customer_email').notNull(),
  customerPhone: text('customer_phone'),
  customerAddress: text('customer_address'),
  customerZip: text('customer_zip'),
  customerNotes: text('customer_notes'),
  assignedUserId: text('assigned_user_id').references(() => user.id, { onDelete: 'set null' }),
  /** 'active' | 'cancelled' */
  status: text('status').default('active').notNull(),
  token: text('token').notNull(),
  cancelledAt: timestamp('cancelled_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  uniqueIndex('booking_series_token_key').on(t.token),
  index('booking_series_company_id_status_idx').on(t.companyId, t.status),
])

/** A booking. start/end are the visit itself; buffers and travel are added around it when finding free times. */
export const booking = pgTable('booking', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  serviceId: text('service_id').references(() => bookingService.id, { onDelete: 'set null' }),
  /** The person booked; matched or created by email when the booking is made. */
  contactId: text('contact_id').references(() => contact.id, { onDelete: 'set null' }),
  seriesId: text('series_id').references(() => bookingSeries.id, { onDelete: 'set null' }),
  /** Its place in the series: 3 of 8. */
  seriesIndex: integer('series_index'),
  startAt: timestamp('start_at').notNull(),
  endAt: timestamp('end_at').notNull(),
  customerName: text('customer_name').notNull(),
  customerEmail: text('customer_email').notNull(),
  customerPhone: text('customer_phone'),
  customerAddress: text('customer_address'),
  customerZip: text('customer_zip'),
  customerNotes: text('customer_notes'),
  /** 'pending' (deposit owed) | 'confirmed' | 'cancelled' | 'completed' | 'no_show' */
  status: text('status').default('confirmed').notNull(),
  assignedUserId: text('assigned_user_id').references(() => user.id, { onDelete: 'set null' }),
  /** 'public' | 'staff' | 'series' */
  source: text('source').default('public').notNull(),
  // Where the booking came from on the site, for the owner's numbers.
  sourcePath: text('source_path'),
  sourceReferrer: text('source_referrer'),
  sourceVariant: text('source_variant'),
  /** The customer's private link to view, reschedule or cancel (/booking/<token>). */
  token: text('token').notNull(),
  depositAmount: money('deposit_amount'),
  /** 'none' | 'pending' | 'paid' | 'expired' | 'refunded' */
  depositStatus: text('deposit_status').default('none').notNull(),
  paymentIntentId: text('payment_intent_id'),
  depositPaidAt: timestamp('deposit_paid_at'),
  tipAmount: money('tip_amount'),
  // When each message about this booking went, so none goes twice.
  reminderEmailSentAt: timestamp('reminder_email_sent_at'),
  reminderSmsSentAt: timestamp('reminder_sms_sent_at'),
  rebookReminderSentAt: timestamp('rebook_reminder_sent_at'),
  reviewRequestSentAt: timestamp('review_request_sent_at'),
  /** The event on the assigned person's own calendar (Google or Outlook), when they have one connected. */
  externalEventId: text('external_event_id'),
  externalProvider: text('external_provider'),
  cancelledAt: timestamp('cancelled_at'),
  cancelledReason: text('cancelled_reason'),
  /**
   * The appointment the booking made in a practice's book (VerticalSettings.booking.calendar 'practice'), kept in step
   * when the booking is moved or its status changes — the CRMs' online_booking.appointment_id (templates/crm-vet).
   */
  appointmentId: text('appointment_id').references(() => appointment.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  uniqueIndex('booking_token_key').on(t.token),
  index('booking_company_id_start_at_idx').on(t.companyId, t.startAt),
  index('booking_company_id_status_idx').on(t.companyId, t.status),
  index('booking_series_id_idx').on(t.seriesId),
  index('booking_contact_id_idx').on(t.contactId),
  index('booking_appointment_id_idx').on(t.appointmentId),
])

/** "Tell me if a time opens up" for a service within some dates. */
export const bookingWaitlist = pgTable('booking_waitlist', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  serviceId: text('service_id').notNull().references(() => bookingService.id, { onDelete: 'cascade' }),
  customerName: text('customer_name').notNull(),
  customerEmail: text('customer_email').notNull(),
  customerPhone: text('customer_phone'),
  customerZip: text('customer_zip'),
  /** YYYY-MM-DD, inclusive; null = open-ended. */
  preferredFrom: text('preferred_from'),
  preferredTo: text('preferred_to'),
  notes: text('notes'),
  /** 'open' | 'notified' | 'booked' | 'expired' */
  status: text('status').default('open').notNull(),
  notifiedAt: timestamp('notified_at'),
  bookingId: text('booking_id').references(() => booking.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('booking_waitlist_company_id_service_id_status_idx').on(t.companyId, t.serviceId, t.status),
])

/** An email or phone that can't book online. */
export const bookingBan = pgTable('booking_ban', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  /** Lowercased. */
  email: text('email'),
  /** Digits only. */
  phone: text('phone'),
  reason: text('reason'),
  addedByUserId: text('added_by_user_id').references(() => user.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('booking_ban_company_id_idx').on(t.companyId),
])

/** Where booking events are posted (signed with the secret): another system the business uses. */
export const bookingWebhook = pgTable('booking_webhook', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  url: text('url').notNull(),
  secret: text('secret').notNull(),
  /** ['booking.created', …] or ['*']. */
  events: json('events').default(['*']).notNull(),
  active: boolean('active').default(true).notNull(),
  lastDeliveryAt: timestamp('last_delivery_at'),
  lastStatus: integer('last_status'),
  failureCount: integer('failure_count').default(0).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('booking_webhook_company_id_idx').on(t.companyId),
])

/** One person's Google or Outlook calendar, for busy times and to put their bookings on it. Tokens are encrypted. */
export const calendarConnection = pgTable('calendar_connection', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  /** 'google' | 'outlook' */
  provider: text('provider').notNull(),
  accountEmail: text('account_email'),
  accessTokenEnc: text('access_token_enc').notNull(),
  refreshTokenEnc: text('refresh_token_enc'),
  expiresAt: timestamp('expires_at'),
  calendarId: text('calendar_id'),
  watchChannelId: text('watch_channel_id'),
  watchResourceId: text('watch_resource_id'),
  watchExpiresAt: timestamp('watch_expires_at'),
  lastSyncAt: timestamp('last_sync_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  uniqueIndex('calendar_connection_user_id_provider_key').on(t.userId, t.provider),
])
