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
