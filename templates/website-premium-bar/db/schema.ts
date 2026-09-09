import { pgTable, uuid, text, timestamp, jsonb, integer, boolean, index, uniqueIndex, numeric } from 'drizzle-orm/pg-core'

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
  // Photographer credits for curated-library photos used on this site.
  // Rendered in the footer by views/base.ejs — required by the Pexels API
  // Guidelines wherever one of their photos appears. Seeded from the
  // factory bootstrap payload; drizzle-kit push adds the column at boot.
  photoCredits: jsonb('photo_credits').notNull().default([]),
  // Hours config for lib/hours: { timezone, bar: WeeklyHours, kitchen: WeeklyHours, holidays: [] }.
  // The ONLY place hours live. Console overrides go in service_status.
  hours: jsonb('hours'),
  contactCtaLabel: text('contact_cta_label').notNull().default('Get in touch'),
  // Brand colors (consumed via CSS variables in build/styles/main.css).
  primaryColor: text('primary_color'),
  secondaryColor: text('secondary_color'),
  accentColor: text('accent_color'),
  // Branding assets
  logoUrl: text('logo_url'),
  faviconUrl: text('favicon_url'),
  headerLogoUrl: text('header_logo_url'),
  // ── Structured address + identity (drives BarOrPub JSON-LD, the /visit
  // page, the voice-agent context, and the console). One source of truth
  // for NAP so listings can't drift. `address` above stays as the display line.
  streetAddress: text('street_address'),
  addressLocality: text('address_locality'),
  addressRegion: text('address_region'),
  postalCode: text('postal_code'),
  geoLat: text('geo_lat'),
  geoLng: text('geo_lng'),
  sameAs: jsonb('same_as').notNull().default([]),   // social + listing URLs
  schemaType: text('schema_type').notNull().default('BarOrPub'),
  siteOrigin: text('site_origin'),                   // canonical origin, e.g. https://amberinneauclaire.com
  servesCuisine: text('serves_cuisine'),             // 'American', 'Bar food'
  priceRange: text('price_range'),                   // '$$'
  established: integer('established'),               // 1881
  timezone: text('timezone').notNull().default('America/Chicago'),
  // ── Typography + theme. base.ejs writes these into --font-* and the
  // Google Fonts request; theme = 'auto' | 'dark' | 'light' (auto follows
  // prefers-color-scheme; the palette is dark-first).
  fontDisplay: text('font_display'),
  fontEyebrow: text('font_eyebrow'),
  fontBody: text('font_body'),
  fontMono: text('font_mono'),
  theme: text('theme').notNull().default('auto'),
  // Tracking IDs — rendered as PLAIN standard snippets in views/base.ejs
  // (Google-tool-detectable; the deferred loader is deliberately NOT used
  // here — see the Claflin field lesson in the one-stop roadmap).
  googleTagManagerId: text('google_tag_manager_id'),
  googleAnalyticsId: text('google_analytics_id'),
  googleAdsId: text('google_ads_id'),
  facebookPixelId: text('facebook_pixel_id'),
  microsoftClarityId: text('microsoft_clarity_id'),

  // Per-tenant token for the show-first customer customizer flow.
  // Customer follows `/customize/<token>` → gets a scoped session that
  // lets them tweak page sections without seeing security/billing/etc.
  // Auto-generated on first boot, rotatable by admin if shared widely.
  customizerToken: text('customizer_token'),
  // CRM Add-on. Set by the factory after scripts/provision-crm-for-
  // tenant.ts succeeds. Drives the "Open CRM →" handoff button in
  // /admin/billing.
  crmUrl: text('crm_url'),
  crmReadyAt: timestamp('crm_ready_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// One row per page (home, about, services, contact, plus any custom
// pages the admin adds later). sections is the JSON array consumed by
// home.ejs / page.ejs — the entire page composition lives here so the
// AI composer can write a whole site by inserting/updating these rows.
// What the content seed last applied, per row ("settings", "page:<slug>"): a
// hash of the seed values and when it was written. initDb re-applies a row
// whose seed changed ONLY if the row's updated_at is not newer than applied_at
// (i.e. nobody edited it in the admin since). See scripts/initDb.ts.
export const seedMarks = pgTable('seed_marks', {
  key: text('key').primaryKey(),
  hash: text('hash').notNull(),
  appliedAt: timestamp('applied_at', { withTimezone: true }).notNull().defaultNow(),
})

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

// -- First-party traffic counter: day x path upsert. No cookies, no PII --
// gives owners "is my site working" numbers without any Google dependency.
export const pageViews = pgTable('page_views', {
  id: uuid('id').primaryKey().defaultRandom(),
  day: text('day').notNull(),   // YYYY-MM-DD (UTC) — lexical compare == date compare
  path: text('path').notNull(),
  count: integer('count').notNull().default(0),
}, (t) => ({
  dayPathIdx: uniqueIndex('page_views_day_path_idx').on(t.day, t.path),
}))

// ── Branded email aliases ───────────────────────────────────────────────────
// A website-only tenant owns their domain but had no way to create a mailbox
// on it. Rules are mirrored to the factory, which owns the Cloudflare Email
// Routing config. routingMode is always 'forward' — 'crm' delivery needs a CRM.
export const emailAlias = pgTable('email_alias', {
  id: uuid('id').primaryKey().defaultRandom(),
  localPart: text('local_part').notNull().unique(),
  routingMode: text('routing_mode').notNull().default('forward'),
  forwardTo: text('forward_to'),
  enabled: boolean('enabled').notNull().default(true),
  lastSyncedAt: timestamp('last_synced_at'),
  syncError: text('sync_error'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// ═══════════════════════════════════════════════════════════════════════════
// BAR TEMPLATE — everything that changes hourly lives below. Square owns the
// menu prices in Phase 2; Postgres owns everything else.
// ═══════════════════════════════════════════════════════════════════════════

// Singleton. The bartender's one-tap controls land here. Overrides carry an
// expiry (`overrideUntil`) so a Friday-night "kitchen closed" can never leave
// Saturday's board wrong — lib/hours ignores an override past its `until`.
export const serviceStatus = pgTable('service_status', {
  id: uuid('id').primaryKey().defaultRandom(),
  // null = follow the hours engine; false = force closed; true = force open (rare).
  kitchenOpen: boolean('kitchen_open'),
  kitchenClosesAt: timestamp('kitchen_closes_at', { withTimezone: true }),   // early/late close override
  barOpen: boolean('bar_open'),
  barClosesAt: timestamp('bar_closes_at', { withTimezone: true }),
  overrideUntil: timestamp('override_until', { withTimezone: true }),         // all of the above lapse here
  roomStatus: text('room_status').notNull().default('quiet'),                 // 'quiet' | 'filling' | 'packed'
  note: text('note'),                                                          // free-text line on the board
  speakeasyPassword: text('speakeasy_password'),                               // the Back Room reward (home-page door game)
  speakeasyNote: text('speakeasy_note'),                                       // what it is good for ("$1 off a root beer")
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text('updated_by'),                                               // staff pin label
})

export const taps = pgTable('taps', {
  id: uuid('id').primaryKey().defaultRandom(),
  lineNumber: integer('line_number').notNull(),
  beerName: text('beer_name').notNull(),
  brewery: text('brewery'),
  style: text('style'),
  abv: numeric('abv', { precision: 4, scale: 1 }),
  originCountry: text('origin_country'),
  description: text('description'),
  badge: text('badge'),                     // e.g. "George Berg Soft Drinks Co. — Est. 1920"
  priceCents: integer('price_cents'),
  // 'pouring' | 'just_tapped' | 'last_keg' | 'blown'. Public site shows only these words.
  status: text('status').notNull().default('pouring'),
  isActive: boolean('is_active').notNull().default(true),
  kegLevelPct: integer('keg_level_pct'),    // Phase 4, Kegtron. Never shown publicly.
  tappedAt: timestamp('tapped_at', { withTimezone: true }),
  blownAt: timestamp('blown_at', { withTimezone: true }),
  untappdId: text('untappd_id'),
  sortOrder: integer('sort_order').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  lineIdx: index('taps_line_idx').on(t.lineNumber),
  activeIdx: index('taps_active_idx').on(t.isActive, t.sortOrder),
}))

export const specials = pgTable('specials', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  description: text('description'),
  priceCents: integer('price_cents'),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true }),
  isRecurring: boolean('is_recurring').notNull().default(false),
  recurrenceRule: text('recurrence_rule'),   // e.g. 'FREQ=WEEKLY;BYDAY=FR'
  postedToGoogle: boolean('posted_to_google').notNull().default(false),
  createdBy: text('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  windowIdx: index('specials_window_idx').on(t.startsAt, t.endsAt),
}))

export const events = pgTable('events', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  title: text('title').notNull(),
  description: text('description'),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true }),
  imageUrl: text('image_url'),
  isRecurring: boolean('is_recurring').notNull().default(false),
  recurrenceRule: text('recurrence_rule'),
  volumeoneSubmitted: boolean('volumeone_submitted').notNull().default(false),
  isPublished: boolean('is_published').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  startIdx: index('events_start_idx').on(t.isPublished, t.startsAt),
}))

export const games = pgTable('games', {
  id: uuid('id').primaryKey().defaultRandom(),
  league: text('league').notNull(),          // 'NFL' | 'NCAAF' | 'MLB' | 'NBA' | ...
  home: text('home').notNull(),
  away: text('away').notNull(),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  isFeatured: boolean('is_featured').notNull().default(false),
  note: text('note'),                        // "doors at 11"
  source: text('source').notNull().default('manual'),   // 'manual' | 'thesportsdb'
  externalId: text('external_id'),
  // Optional game-day hours override, same shape as lib/hours DateOverride ranges.
  barHours: jsonb('bar_hours'),
  kitchenHours: jsonb('kitchen_hours'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  startIdx: index('games_start_idx').on(t.startsAt, t.isFeatured),
}))

// Menu. Phase 1 seeds from content/menu.json; Phase 2 upserts from the Square
// Catalog by square_item_id and keeps the local-only columns (story, hero,
// is86ed, isSignature, slug) — this table IS the spec's menu_overrides layer.
export const menuSections = pgTable('menu_sections', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  description: text('description'),
  kind: text('kind').notNull().default('food'),   // 'food' | 'drink'
  squareCategoryId: text('square_category_id'),
  sortOrder: integer('sort_order').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
})

export const menuItems = pgTable('menu_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  sectionId: uuid('section_id').references(() => menuSections.id, { onDelete: 'set null' }),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  description: text('description'),
  priceCents: integer('price_cents'),
  priceLabel: text('price_label'),            // "market" / "½ lb $14 · ¼ lb $10" when a single price won't do
  dietary: jsonb('dietary').notNull().default([]),   // ['GF','V',...]
  imageUrl: text('image_url'),
  heroImageUrl: text('hero_image_url'),       // for the item's own page (/burgers/<slug>)
  story: text('story'),                       // markdown, for the item's own page
  isSignature: boolean('is_signature').notNull().default(false),   // gets its own URL + MenuItem schema
  is86ed: boolean('is_86ed').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  squareItemId: text('square_item_id'),
  squareVariationId: text('square_variation_id'),
  sortOrder: integer('sort_order').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  sectionIdx: index('menu_items_section_idx').on(t.sectionId, t.sortOrder),
  squareIdx: index('menu_items_square_idx').on(t.squareItemId),
}))

export const timelineEntries = pgTable('timeline_entries', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),      // '1881', '1920', 'oldest-bar-in-wisconsin'
  yearStart: integer('year_start'),
  yearEnd: integer('year_end'),
  title: text('title').notNull(),
  bodyMd: text('body_md').notNull().default(''),
  imageUrl: text('image_url'),
  imageCredit: text('image_credit'),
  imageYear: integer('image_year'),
  thenImageUrl: text('then_image_url'),       // then-and-now pair
  nowImageUrl: text('now_image_url'),
  sortOrder: integer('sort_order').notNull().default(0),
  isPublished: boolean('is_published').notNull().default(true),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const partyInquiries = pgTable('party_inquiries', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  phone: text('phone').notNull(),
  email: text('email'),
  partySize: integer('party_size'),
  requestedDate: text('requested_date'),       // YYYY-MM-DD as typed; not a booking
  occasion: text('occasion'),
  message: text('message'),
  status: text('status').notNull().default('new'),   // 'new' | 'called' | 'booked' | 'closed' | 'spam'
  smsSentAt: timestamp('sms_sent_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  statusIdx: index('party_inquiries_status_idx').on(t.status, t.createdAt),
}))

// Birthday club / Regulars list. Consent evidence retained >= 4 years (SPEC s12).
export const subscribers = pgTable('subscribers', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  name: text('name'),
  birthdayMonth: integer('birthday_month'),
  birthdayDay: integer('birthday_day'),
  consentSource: text('consent_source').notNull(),   // 'website:/regulars'
  consentText: text('consent_text').notNull(),       // the exact disclosure shown
  consentAt: timestamp('consent_at', { withTimezone: true }).notNull().defaultNow(),
  consentIp: text('consent_ip'),
  squareCustomerId: text('square_customer_id'),
  unsubscribedAt: timestamp('unsubscribed_at', { withTimezone: true }),
})

// Console PINs (one per bartender/label) and the sessions they mint.
export const staffPins = pgTable('staff_pins', {
  id: uuid('id').primaryKey().defaultRandom(),
  label: text('label').notNull(),              // "Bar phone", "Jess"
  pinHash: text('pin_hash').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
})

export const staffSessions = pgTable('staff_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  pinId: uuid('pin_id').notNull().references(() => staffPins.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
})

// Phase 3: every voice-agent call, with transcript, surfaced in the console.
export const callLogs = pgTable('call_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  provider: text('provider').notNull(),        // 'vapi' | 'retell'
  externalId: text('external_id'),
  fromNumber: text('from_number'),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  durationSeconds: integer('duration_seconds'),
  outcome: text('outcome'),                    // 'answered' | 'transferred' | 'voicemail' | 'failed'
  summary: text('summary'),
  transcript: text('transcript'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
