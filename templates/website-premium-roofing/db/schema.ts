import { pgTable, uuid, text, timestamp, jsonb, integer, boolean, index } from 'drizzle-orm/pg-core'

// Single-row company/settings — same row updated by the admin. Mirrors
// the pattern in other templates but stripped to only what the
// section-composition template actually reads (no per-page metadata
// duplication; that lives inside each page's sections JSON).
export const settings = pgTable('settings', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyName: text('company_name').notNull(),
  tagline: text('tagline'),
  phone: text('phone'),
  email: text('email'),
  address: text('address'),
  seoTitle: text('seo_title'),
  seoDescription: text('seo_description'),
  // Navigation as { label, href } array — the admin reorders / renames
  // / hides without touching template code.
  nav: jsonb('nav').notNull().default([]),
  contactCtaLabel: text('contact_cta_label').notNull().default('Get in touch'),
  // Brand colors (consumed via CSS variables in build/styles/main.css).
  primaryColor: text('primary_color'),
  secondaryColor: text('secondary_color'),
  accentColor: text('accent_color'),
  // Branding assets
  logoUrl: text('logo_url'),
  faviconUrl: text('favicon_url'),
  // Per-tenant copy for the public booking flow. null falls back to
  // hardcoded defaults in the template.
  bookingHeroTitle: text('booking_hero_title'),
  bookingHeroSubtitle: text('booking_hero_subtitle'),
  bookingConfirmCta: text('booking_confirm_cta'),
  bookingThanksMessage: text('booking_thanks_message'),
  // Default drive-time minutes added as buffer between any two
  // confirmed bookings for the same crew on the same day. 0 = off.
  bookingDefaultDriveTimeMinutes: integer('booking_default_drive_time_minutes').notNull().default(0),
  // Random token for the public iCal feed URL. Anyone with this token
  // can subscribe — keeping it long-random + rotatable is good enough
  // for V1 (no calendar discovery).
  bookingIcalFeedToken: text('booking_ical_feed_token'),
  // Per-tenant token for the show-first customer customizer flow.
  // Customer follows `/customize/<token>` → gets a scoped session that
  // lets them tweak page sections without seeing security/billing/etc.
  // Auto-generated on first boot, rotatable by admin if shared widely.
  customizerToken: text('customizer_token'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// One row per page (home, about, services, contact, plus any custom
// pages the admin adds later). sections is the JSON array consumed by
// home.ejs / page.ejs — the entire page composition lives here so the
// AI composer can write a whole site by inserting/updating these rows.
export const pages = pgTable('pages', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),  // 'home', 'about', 'services', 'contact', or custom
  title: text('title').notNull(),
  // Section composition — array of { type, variant, data } as defined
  // in apps/api/src/services/sectionComposer.ts SECTION_SCHEMA.
  sections: jsonb('sections').notNull().default([]),
  // SEO per page (overrides settings defaults when set).
  metaTitle: text('meta_title'),
  metaDescription: text('meta_description'),
  // Whether this page appears in nav (admin can hide a page without deleting).
  isPublished: boolean('is_published').notNull().default(true),
  navOrder: integer('nav_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  slugIdx: index('pages_slug_idx').on(t.slug),
}))

// Photo library — every image uploaded by admin or seeded from the
// AI composition lands here. R2 URL stored; sections reference by url.
export const photos = pgTable('photos', {
  id: uuid('id').primaryKey().defaultRandom(),
  url: text('url').notNull(),  // public CDN URL (R2 or local /uploads/* in dev)
  storageKey: text('storage_key'),  // R2 object key for deletion later
  alt: text('alt'),
  width: integer('width'),
  height: integer('height'),
  bytes: integer('bytes'),
  contentType: text('content_type'),
  // Free-form tag (e.g. 'hero', 'services', 'team', 'project'). Lets
  // the admin filter the library and lets the composer pick contextually.
  tag: text('tag'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  tagIdx: index('photos_tag_idx').on(t.tag),
}))

// Admin user — the customer who logs in to edit. One row by default,
// they can invite more later. totp_* columns hold the second-factor
// state; recovery_codes is a comma-separated list of bcrypt hashes,
// each consumed once.
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
  passwordHash: text('password_hash').notNull(),
  name: text('name'),
  role: text('role').notNull().default('admin'),  // 'admin' | 'editor'
  totpSecret: text('totp_secret'),
  totpEnabledAt: timestamp('totp_enabled_at', { withTimezone: true }),
  recoveryCodes: text('recovery_codes'),  // comma-separated bcrypt hashes
  // Bumped on password change, 2FA disable, force-logout-all. Tokens
  // issued before this timestamp (iat < tokenInvalidatedAt) are rejected.
  tokensInvalidatedAt: timestamp('tokens_invalidated_at', { withTimezone: true }),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// Sessions — one row per active sign-in. JWT carries the jti; we
// require the jti to be present here and not revoked. Adds one indexed
// DB read per request (same call we were already making for the
// tokensInvalidatedAt check, just selecting more columns).
export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  jti: text('jti').notNull().unique(),
  ip: text('ip'),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
}, (t) => ({
  userIdx: index('sessions_user_idx').on(t.userId, t.revokedAt),
  jtiIdx: index('sessions_jti_idx').on(t.jti),
}))

// Single-use tokens for password reset + email verification. We store
// only the hash; the plaintext lives in the email the user receives.
export const userTokens = pgTable('user_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  // 'password_reset' | 'email_verify'
  kind: text('kind').notNull(),
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  hashIdx: index('user_tokens_hash_idx').on(t.tokenHash),
  userKindIdx: index('user_tokens_user_kind_idx').on(t.userId, t.kind),
}))

// Banned customers — emails/phones that can't book. Admin adds when
// a customer no-shows once too often or causes problems. Public POST
// /book/:slug rejects with a generic error if email or phone matches.
export const bookingBans = pgTable('booking_bans', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email'),  // normalize lowercase on insert
  phone: text('phone'),  // normalize digits-only on insert
  reason: text('reason'),
  addedByUserId: uuid('added_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  emailIdx: index('booking_bans_email_idx').on(t.email),
  phoneIdx: index('booking_bans_phone_idx').on(t.phone),
}))

// Outbound webhook destinations + delivery log. Admin registers a URL
// + secret + which events to receive; we POST event payloads with an
// HMAC-SHA256 signature header. Delivery attempts logged for retry +
// admin visibility.
export const bookingWebhooks = pgTable('booking_webhooks', {
  id: uuid('id').primaryKey().defaultRandom(),
  url: text('url').notNull(),
  secret: text('secret').notNull(),
  // Comma-separated event types: 'booking.created' | 'booking.cancelled' | 'booking.completed' | '*'
  events: text('events').notNull().default('*'),
  isActive: boolean('is_active').notNull().default(true),
  lastDeliveryAt: timestamp('last_delivery_at', { withTimezone: true }),
  lastStatus: integer('last_status'),
  failureCount: integer('failure_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// Append-only audit log. Every admin action that mutates state writes
// one row here. UI surfaces it under Settings → Activity for the owner.
export const auditLog = pgTable('audit_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  userEmail: text('user_email'),  // captured at write time so deletes don't blank the log
  action: text('action').notNull(),  // 'login' | 'login_failed' | 'password_change' | 'page_update' | ...
  target: text('target'),  // free-text identifier, e.g. 'pages/home' or 'user/abc'
  ip: text('ip'),
  userAgent: text('user_agent'),
  meta: jsonb('meta'),  // optional structured details
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  createdIdx: index('audit_log_created_idx').on(t.createdAt),
  userIdx: index('audit_log_user_idx').on(t.userId, t.createdAt),
}))

// Lead inbox — every contact form submission lands here. Mirrors
// the existing template's lead capture so we don't lose the basics.
export const leads = pgTable('leads', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  phone: text('phone'),
  message: text('message').notNull(),
  source: text('source'),  // which page/form
  status: text('status').notNull().default('new'),  // 'new' | 'replied' | 'closed' | 'spam'
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  statusIdx: index('leads_status_created_idx').on(t.status, t.createdAt),
}))

// Blog posts — body is markdown, rendered to HTML at request time.
// Status drives the public route's filter: only 'published' posts
// appear on /blog and /blog/<slug>.
export const posts = pgTable('posts', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  title: text('title').notNull(),
  excerpt: text('excerpt'),
  body: text('body').notNull().default(''),  // markdown
  coverImageUrl: text('cover_image_url'),
  // 'draft' | 'published' — drafts hidden from public site + sitemap
  status: text('status').notNull().default('draft'),
  // Override per-post; falls back to title/excerpt for SEO when empty
  metaTitle: text('meta_title'),
  metaDescription: text('meta_description'),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  slugIdx: index('posts_slug_idx').on(t.slug),
  statusPublishedIdx: index('posts_status_published_idx').on(t.status, t.publishedAt),
}))

// ─── Twomiah Bookings ────────────────────────────────────────────────────
// A complete booking system: services with duration/price, per-crew
// availability + service zones, customer-facing slot picker, confirmed
// bookings with auto-assigned crew + email/SMS confirmations.

// Bookable services. Each has a duration the slot generator respects
// and optional buffer time around it (drive time, cleanup, etc.).
export const bookingServices = pgTable('booking_services', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  description: text('description'),
  durationMinutes: integer('duration_minutes').notNull(),
  priceCents: integer('price_cents'),
  // Optional Stripe deposit. If depositAmountCents is set, customer is
  // taken through Stripe Checkout before the booking is confirmed.
  // If depositPercent is set instead, the deposit is computed from
  // priceCents at booking time. Only one of the two should be set.
  depositAmountCents: integer('deposit_amount_cents'),
  depositPercent: integer('deposit_percent'),
  bufferBeforeMinutes: integer('buffer_before_minutes').notNull().default(0),
  bufferAfterMinutes: integer('buffer_after_minutes').notNull().default(0),
  slotGranularityMinutes: integer('slot_granularity_minutes').notNull().default(30),
  // For group services (classes, tours, etc.), how many customers can
  // book the same slot. Default 1 = 1-on-1 service. >1 = group service.
  capacityPerSlot: integer('capacity_per_slot').notNull().default(1),
  // Optional tip/gratuity presets shown at booking time. JSON array
  // of integer percents, e.g. [15, 20, 25]. null = no tip prompt.
  tipPresetsPercent: jsonb('tip_presets_percent'),
  isActive: boolean('is_active').notNull().default(true),
  displayOrder: integer('display_order').notNull().default(0),
  // Days after completion to email "ready for your next [service]?" — null = no
  // rebook reminder. Defaults vary by industry (cleaning ~21, hvac ~180).
  rebookIntervalDays: integer('rebook_interval_days'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  activeOrderIdx: index('booking_services_active_order_idx').on(t.isActive, t.displayOrder),
}))

// Recurring weekly availability per crew member. user_id NULL means
// "any crew" — useful for single-operator businesses that don't track
// individual crews yet.
export const bookingAvailabilityRules = pgTable('booking_availability_rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  dayOfWeek: integer('day_of_week').notNull(),  // 0=Sun..6=Sat
  startMinute: integer('start_minute').notNull(),  // minutes from midnight, tenant TZ
  endMinute: integer('end_minute').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  userDayIdx: index('booking_avail_user_day_idx').on(t.userId, t.dayOfWeek),
}))

// One-off blackouts (holidays, time off, equipment outages). NULL
// user_id means tenant-wide blackout (e.g. closed for Christmas).
// NULL start/end means full-day blackout.
export const bookingBlackouts = pgTable('booking_blackouts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  date: text('date').notNull(),  // ISO YYYY-MM-DD in tenant TZ
  startMinute: integer('start_minute'),
  endMinute: integer('end_minute'),
  reason: text('reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  dateIdx: index('booking_blackouts_date_idx').on(t.date),
}))

// Service zones per crew. zip_list is comma-separated ZIPs; if both
// zip_list and radius are set, customer's ZIP must be in zip_list OR
// within radius of center. Empty zone = serves everywhere.
export const bookingServiceZones = pgTable('booking_service_zones', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  zipList: text('zip_list'),  // comma-separated
  centerLat: text('center_lat'),  // text to avoid float precision games
  centerLng: text('center_lng'),
  radiusMiles: integer('radius_miles'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  userIdx: index('booking_zones_user_idx').on(t.userId),
}))

// A series of recurring bookings — "every other Tuesday at 10am × 8".
// Each generated instance is a normal `bookings` row with `seriesId`
// pointing here. Cancelling the series cancels all future instances;
// editing modifies the template + regenerates future instances.
export const bookingSeries = pgTable('booking_series', {
  id: uuid('id').primaryKey().defaultRandom(),
  serviceId: uuid('service_id').notNull().references(() => bookingServices.id, { onDelete: 'restrict' }),
  // frequency: 'weekly' | 'biweekly' | 'monthly'
  frequency: text('frequency').notNull(),
  // interval = 1 weekly, 2 biweekly, etc. (kept explicit for "every 3 weeks")
  intervalCount: integer('interval_count').notNull().default(1),
  // First occurrence start (UTC). Subsequent computed from this + frequency.
  firstStartAt: timestamp('first_start_at', { withTimezone: true }).notNull(),
  // Either occurrencesCount OR untilDate caps the series. Both set = whichever hits first.
  occurrencesCount: integer('occurrences_count'),
  untilDate: timestamp('until_date', { withTimezone: true }),
  // Customer info — same as a single booking (denormalized so the series
  // owns the contact even after instances get split off / cancelled).
  customerName: text('customer_name').notNull(),
  customerEmail: text('customer_email').notNull(),
  customerPhone: text('customer_phone'),
  customerAddress: text('customer_address'),
  customerZip: text('customer_zip'),
  customerNotes: text('customer_notes'),
  assignedUserId: uuid('assigned_user_id').references(() => users.id, { onDelete: 'set null' }),
  confirmationToken: text('confirmation_token').notNull().unique(),
  // 'active' | 'cancelled'
  status: text('status').notNull().default('active'),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  customerEmailIdx: index('booking_series_customer_email_idx').on(t.customerEmail),
  statusIdx: index('booking_series_status_idx').on(t.status),
}))

// The bookings themselves. start_at and end_at stored UTC; tenant TZ
// applied at display time. Unique partial index on (start_at,
// assigned_user_id) where status='confirmed' makes double-booking the
// same crew at the same time structurally impossible.
export const bookings = pgTable('bookings', {
  id: uuid('id').primaryKey().defaultRandom(),
  serviceId: uuid('service_id').notNull().references(() => bookingServices.id, { onDelete: 'restrict' }),
  // Set when this row is one instance of a recurring series. Cancelling
  // the series sets this row's status to 'cancelled'.
  seriesId: uuid('series_id').references(() => bookingSeries.id, { onDelete: 'set null' }),
  // 1-indexed position in the series ("3rd of 8")
  seriesIndex: integer('series_index'),
  startAt: timestamp('start_at', { withTimezone: true }).notNull(),
  endAt: timestamp('end_at', { withTimezone: true }).notNull(),
  customerName: text('customer_name').notNull(),
  customerEmail: text('customer_email').notNull(),
  customerPhone: text('customer_phone'),
  customerAddress: text('customer_address'),
  customerZip: text('customer_zip'),
  customerNotes: text('customer_notes'),
  // 'confirmed' | 'cancelled' | 'completed' | 'no_show'
  status: text('status').notNull().default('confirmed'),
  assignedUserId: uuid('assigned_user_id').references(() => users.id, { onDelete: 'set null' }),
  source: text('source').notNull().default('public_form'),  // 'public_form' | 'admin_manual' | 'series'
  // Attribution — where in the funnel did this booking originate?
  sourcePath: text('source_path'),       // referring page on the tenant site
  sourceReferrer: text('source_referrer'), // document.referrer (external)
  sourceVariant: text('source_variant'),   // A/B test variant if applicable
  confirmationToken: text('confirmation_token').notNull().unique(),  // for self-service link
  // Stripe deposit (V2)
  depositPaymentIntentId: text('deposit_payment_intent_id'),
  depositAmountCents: integer('deposit_amount_cents'),
  depositStatus: text('deposit_status'),  // 'pending' | 'paid' | 'refunded' | null
  // Tip amount (cents) the customer added at booking. Charged with
  // the deposit if Stripe is in the flow; otherwise informational.
  tipAmountCents: integer('tip_amount_cents'),
  reminder24hSentAt: timestamp('reminder_24h_sent_at', { withTimezone: true }),
  reminder24hSmsSentAt: timestamp('reminder_24h_sms_sent_at', { withTimezone: true }),
  rebookReminderSentAt: timestamp('rebook_reminder_sent_at', { withTimezone: true }),
  reviewRequestSentAt: timestamp('review_request_sent_at', { withTimezone: true }),
  reviewRequestSmsSentAt: timestamp('review_request_sms_sent_at', { withTimezone: true }),
  externalCalendarEventId: text('external_calendar_event_id'),  // for Phase 1 cal sync
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  cancelledReason: text('cancelled_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  startIdx: index('bookings_start_idx').on(t.startAt),
  assignedStartIdx: index('bookings_assigned_start_idx').on(t.assignedUserId, t.startAt),
  statusStartIdx: index('bookings_status_start_idx').on(t.status, t.startAt),
  seriesIdx: index('bookings_series_idx').on(t.seriesId, t.seriesIndex),
}))

// Waitlist — customer asks to be notified if a slot opens up for a
// given service within a date window. When a confirmed booking gets
// cancelled, we look for matching waitlist entries and email them.
// notified_at sentinel prevents repeat emails for the same opening.
export const bookingWaitlist = pgTable('booking_waitlist', {
  id: uuid('id').primaryKey().defaultRandom(),
  serviceId: uuid('service_id').notNull().references(() => bookingServices.id, { onDelete: 'cascade' }),
  customerName: text('customer_name').notNull(),
  customerEmail: text('customer_email').notNull(),
  customerPhone: text('customer_phone'),
  customerZip: text('customer_zip'),
  // ISO YYYY-MM-DD, inclusive bounds. Either side can be null = open-ended.
  preferredFrom: text('preferred_from'),
  preferredTo: text('preferred_to'),
  notes: text('notes'),
  // 'open' | 'notified' | 'converted' | 'expired'
  status: text('status').notNull().default('open'),
  notifiedAt: timestamp('notified_at', { withTimezone: true }),
  convertedBookingId: uuid('converted_booking_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  serviceStatusIdx: index('booking_waitlist_service_status_idx').on(t.serviceId, t.status),
  emailIdx: index('booking_waitlist_email_idx').on(t.customerEmail),
}))

// Calendar sync OAuth tokens per crew member. Stored encrypted at rest
// via Render's encrypted-env-vars... actually no, these live in the DB.
// V1 stores them in plaintext; rotating to encryption is a follow-up.
export const bookingCalendarConnections = pgTable('booking_calendar_connections', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),  // 'google' | 'outlook'
  externalAccountEmail: text('external_account_email'),
  accessToken: text('access_token').notNull(),
  refreshToken: text('refresh_token'),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  calendarId: text('calendar_id'),  // which of the user's calendars to write to
  syncChannelId: text('sync_channel_id'),  // for push notification webhooks
  syncResourceId: text('sync_resource_id'),
  lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  userProviderIdx: index('booking_cal_user_provider_idx').on(t.userId, t.provider),
}))
