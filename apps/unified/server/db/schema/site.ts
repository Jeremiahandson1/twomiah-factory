// Website layer (SPEC §4.2): the public site's settings, pages, posts, portfolio and visit counts. From the premium
// site's Postgres schema (templates/website-premium-*/db/schema.ts before the 10/13 SQLite move), conformed to the
// rulebook: singular names, the standard id, json not jsonb, timestamps without a zone, company_id on each record.
//
// Where the site had its own copy of something the app already has, it uses the app's:
//   settings.companyName/phone/email/address, primary/secondary colour, logo → company
//   users, sessions, user_tokens, TOTP on the user → user + mfa_* (one sign-in for site and CRM)
//   photos → photo (is_public)        leads → lead / contact (the CRM's enquiry routing)
//   email_alias → email_alias         projects (portfolio) → portfolio_item, because the CRM's `project` is a job
// The booking copy and settings move with bookings (step 2d); settings.crmUrl/crmReadyAt end: site and CRM are one app.
import { pgTable, text, integer, boolean, timestamp, json, index, uniqueIndex } from 'drizzle-orm/pg-core'
import { createId } from '@paralleldrive/cuid2'
import { company } from './core.ts'

/** The website's own settings: one row per company. */
// Named website, not site: the CRMs' own  table is a customer's service location (bar, basic, field service,
// landscaping), and its rows move across under that name.
export const website = pgTable('website', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  tagline: text('tagline'),
  seoTitle: text('seo_title'),
  seoDescription: text('seo_description'),
  /** Navigation as [{ label, href }]: the owner reorders, renames or hides without touching a template. */
  nav: json('nav').default([]).notNull(),
  /** Credits for curated-library photos, printed in the footer (the Pexels guidelines require it). */
  photoCredits: json('photo_credits').default([]).notNull(),
  /** "Finish your site": what the composer left out for want of the owner's facts — [{ id, label, unlocks, done? }]. */
  contentGaps: json('content_gaps').default([]).notNull(),
  /** Places the business serves — one /service-areas page each. */
  serviceAreas: json('service_areas').default([]).notNull(),
  /** Dealers: the inventory feed behind /inventory. */
  inventoryFeedUrl: text('inventory_feed_url'),
  contactCtaLabel: text('contact_cta_label').default('Get in touch').notNull(),
  accentColor: text('accent_color'),
  faviconUrl: text('favicon_url'),
  // Tracking ids, printed as the plain standard snippets so Google's tools can detect them.
  googleTagManagerId: text('google_tag_manager_id'),
  googleAnalyticsId: text('google_analytics_id'),
  googleAdsId: text('google_ads_id'),
  facebookPixelId: text('facebook_pixel_id'),
  microsoftClarityId: text('microsoft_clarity_id'),
  /** The show-first customizer link: /customize/<token> gives the customer a session limited to page sections. */
  customizerToken: text('customizer_token'),
  /**
   * The site's design (site/designs/<design>.css on top of the base): the look a premium template family had.
   * Empty = the vertical's default. Set per tenant because one vertical can wear another's look ('basic' takes the
   * one matching the business's trade).
   */
  design: text('design'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  uniqueIndex('website_company_id_key').on(t.companyId),
])

export const page = pgTable('page', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  /** 'home', 'about', 'services', 'contact', or the owner's own. */
  slug: text('slug').notNull(),
  title: text('title').notNull(),
  /** The composition: [{ type, variant, data }] (apps/api/src/services/sectionComposer.ts SECTION_SCHEMA). */
  sections: json('sections').default([]).notNull(),
  /** Per-page SEO; falls back to the site's. */
  metaTitle: text('meta_title'),
  metaDescription: text('meta_description'),
  /** Shown in the navigation; the owner can hide a page without deleting it. */
  isPublished: boolean('is_published').default(true).notNull(),
  navOrder: integer('nav_order').default(0).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  uniqueIndex('page_company_id_slug_key').on(t.companyId, t.slug),
])

export const post = pgTable('post', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  slug: text('slug').notNull(),
  title: text('title').notNull(),
  excerpt: text('excerpt'),
  /** Markdown. */
  body: text('body').default('').notNull(),
  coverImageUrl: text('cover_image_url'),
  /** 'draft' | 'published': drafts are hidden from the public site and the sitemap. */
  status: text('status').default('draft').notNull(),
  metaTitle: text('meta_title'),
  metaDescription: text('meta_description'),
  publishedAt: timestamp('published_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  uniqueIndex('post_company_id_slug_key').on(t.companyId, t.slug),
  index('post_status_published_at_idx').on(t.status, t.publishedAt),
])

/** A finished piece of work shown on the website (the site's "projects"; a CRM project is a job in progress). */
export const portfolioItem = pgTable('portfolio_item', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  slug: text('slug').notNull(),
  title: text('title').notNull(),
  location: text('location'),
  summary: text('summary'),
  /** Markdown. */
  body: text('body').default('').notNull(),
  coverImageUrl: text('cover_image_url'),
  /** Photo URLs, in order. */
  photos: json('photos').default([]).notNull(),
  /** 'draft' | 'published' */
  status: text('status').default('draft').notNull(),
  sortOrder: integer('sort_order').default(0).notNull(),
  metaTitle: text('meta_title'),
  metaDescription: text('meta_description'),
  publishedAt: timestamp('published_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  uniqueIndex('portfolio_item_company_id_slug_key').on(t.companyId, t.slug),
  index('portfolio_item_status_sort_order_idx').on(t.status, t.sortOrder),
])

/** Visits per path per day. `day` is YYYY-MM-DD in UTC, so comparing the text compares the dates. */
export const pageView = pgTable('page_view', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  day: text('day').notNull(),
  path: text('path').notNull(),
  count: integer('count').default(0).notNull(),
}, (t) => [
  uniqueIndex('page_view_company_id_day_path_key').on(t.companyId, t.day, t.path),
])
