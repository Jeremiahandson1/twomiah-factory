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
// they can invite more later.
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name: text('name'),
  role: text('role').notNull().default('admin'),  // 'admin' | 'editor'
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

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
