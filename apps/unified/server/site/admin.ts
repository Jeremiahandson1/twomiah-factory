// The website's admin API (/api/site): its pages, settings, photos, blog, portfolio and visit numbers. Moved from the
// premium site's routes/admin.ts, with three changes:
//   • Every action checks a permission (site:read, site:update, site:delete; settings site:settings). The site's
//     routes only checked that someone was signed in, so any signed-in person could change the site's settings.
//   • Replies in the rulebook's shapes (§3) instead of wrappers ({ pages }, { page }…).
//   • The company's own facts (name, phone, email, address, colours, logo) are edited in one place, the company
//     settings (/api/company); this edits what is the website's alone.
// Bookings move with the one booking engine (step 2d); the customize link with the admin screens.
import { Hono } from 'hono'
import { and, asc, desc, eq, gte, inArray } from 'drizzle-orm'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import sharp from 'sharp'
import { website, page, post, portfolioItem, photo, pageView, lead, contact } from '../db/schema/index.ts'
import { SITE_DESIGNS, SITE_DESIGN_LABELS, type VerticalSettings } from '../core/vertical.ts'
import { list, one, fail, done } from '../http/reply.ts'
import type { AppEnv } from '../http/env.ts'
import { RESERVED_SLUGS, SLUG_RE } from './slugs.ts'
import { VIEWS } from './render.ts'

/** Where public website photos are kept: the one prefix /media serves (site/routes.ts). */
export const PUBLIC_PHOTO_PREFIX = 'photos/'

/** The file store, injectable so a test can stand one in (production: the shared R2 storage). */
export interface PhotoStore {
  put(key: string, body: Buffer, contentType: string): Promise<void>
  getObject(key: string): Promise<{ body: ArrayBuffer | Uint8Array | Buffer; contentType: string } | null>
  remove(key: string): Promise<void>
}

// Sections the server fills in itself (live menu, inventory, portfolio, service areas, tools, a bar's signature-item page,
// which the bar's facts make at /<menu-section>/<item>) aren't offered in "Add a section".
export const SERVER_BUILT_SECTIONS = new Set(['areas/list', 'projects/grid', 'projects/detail', 'menu/live', 'menu/item-hero', 'inventory/live', 'inventory/unit', 'tools/visualizer', 'tools/estimator'])

/**
 * Sections that work only on a vertical's own add-on, and are offered only to a vertical that has it: the ones that read
 * the live facts (`site`/`live`, SiteSettings.facts — the bar's night, menu, taps, hours, events, story, speakeasy door)
 * and the forms only that vertical's CRM takes (CrmSettings.websiteForms — the bar's party request and Regulars sign-up).
 * On any other site they would draw an empty board or post a form nothing is waiting for. Every other section is the
 * whole library's (tests/site-section-fields.test.ts holds every view that reads `site`/`live` to an entry here).
 */
export const ADDON_SECTIONS: Record<string, { facts?: 'bar'; websiteForms?: 'bar' }> = {
  'tonight/board': { facts: 'bar' }, 'taps/wall': { facts: 'bar' }, 'menu/sections': { facts: 'bar' }, 'hours/table': { facts: 'bar' },
  'events/list': { facts: 'bar' }, 'speakeasy/door': { facts: 'bar' },
  'timeline/eras': { facts: 'bar' }, 'timeline/era': { facts: 'bar' }, 'timeline/book': { facts: 'bar' },
  'regulars/signup': { facts: 'bar', websiteForms: 'bar' }, 'parties/inquiry-form': { websiteForms: 'bar' },
}

/** Whether this vertical's site can draw a section of the library. */
export function offersSection(key: string, vertical: VerticalSettings): boolean {
  if (SERVER_BUILT_SECTIONS.has(key)) return false
  const needs = ADDON_SECTIONS[key]
  if (!needs) return true
  return (!needs.facts || vertical.site.facts === needs.facts) && (!needs.websiteForms || vertical.crm?.websiteForms === needs.websiteForms)
}
const POST_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,80}[a-z0-9])?$/
const IMAGE_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'])
const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const optText = (v: unknown, max: number) => (typeof v === 'string' ? (v.trim() ? v.slice(0, max) : null) : v === null ? null : undefined)
const allOf = <T>(rows: T[]) => ({ page: 1, limit: Math.max(rows.length, 1), total: rows.length })

/** The website's own settings a person may change (the company's facts live in /api/company). */
const SETTINGS_TEXT: Array<[keyof typeof website.$inferInsert, number]> = [
  ['tagline', 300], ['seoTitle', 200], ['seoDescription', 400], ['contactCtaLabel', 60], ['accentColor', 20], ['faviconUrl', 2000],
  ['googleTagManagerId', 40], ['googleAnalyticsId', 40], ['googleAdsId', 40], ['facebookPixelId', 40], ['microsoftClarityId', 40],
]

/**
 * One picture into the website's library: web-friendly (a PNG with transparency stays PNG; everything else becomes a
 * JPEG at quality 82, turned upright), stored under the public prefix, and its row made. Null when it isn't an image.
 * The owner's upload and the Factory's intake photos (createSeedPhotosRoute) both come through here.
 */
export async function savePublicPhoto(deps: { db: any; store: PhotoStore }, raw: Buffer, input: { companyId: string; userId: string | null; originalName: string | null; tag?: unknown; alt?: unknown }) {
  let meta: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>
  try { meta = await sharp(raw).metadata() } catch { return null }
  const keepPng = meta.format === 'png' && !!meta.hasAlpha
  const out = keepPng ? raw : await sharp(raw).rotate().jpeg({ quality: 82, mozjpeg: true }).toBuffer()
  const contentType = keepPng ? 'image/png' : 'image/jpeg'
  const key = PUBLIC_PHOTO_PREFIX + crypto.randomUUID() + (keepPng ? '.png' : '.jpg')
  await deps.store.put(key, out, contentType)
  const tag = typeof input.tag === 'string' && input.tag.trim() ? input.tag.trim().slice(0, 40) : null
  const [row] = await deps.db.insert(photo).values({
    companyId: input.companyId, userId: input.userId, filename: key, originalName: input.originalName,
    mimeType: contentType, size: out.length, width: meta.width ?? null, height: meta.height ?? null,
    tags: tag ? [tag] : [], isPublic: true, publicUrl: '/media/' + key,
    alt: typeof input.alt === 'string' && input.alt.trim() ? input.alt.trim().slice(0, 300) : null,
  }).returning()
  return row
}

/**
 * /api/internal/seed-photos — the photos a business gave at signup, copied into its own library (the premium sites'
 * server-static.ts seed-photos). The Factory sends short-lived signed links to its intake storage after the build,
 * `{ photos: [{ url, tag?, alt? }] }`; each is fetched, made web-friendly and kept, so the site's pictures outlive the
 * links. Answers `{ seeded, errors? }`, which the Factory logs. The registry checks the key.
 */
export function createSeedPhotosRoute(deps: { db: any; store: PhotoStore; companyId: () => Promise<string | null> }) {
  return new Hono().post('/', async (c) => {
    const body = await c.req.json().catch(() => null) as { photos?: Array<{ url?: unknown; tag?: unknown; alt?: unknown }> } | null
    if (!body) return fail(c, 400, 'Invalid JSON')
    const incoming = Array.isArray(body.photos) ? body.photos : []
    if (!incoming.length) return one(c, { seeded: 0 })
    const companyId = await deps.companyId()
    if (!companyId) return fail(c, 409, 'This business is not set up yet', 'not_provisioned')
    let seeded = 0
    const errors: Array<{ url: string; error: string }> = []
    for (const p of incoming.slice(0, 50)) {
      const url = typeof p?.url === 'string' ? p.url : ''
      if (!/^https?:\/\//i.test(url)) { if (url) errors.push({ url, error: 'not a web address' }); continue }
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(30_000) })
        if (!res.ok) throw new Error('fetch failed: ' + res.status)
        const raw = Buffer.from(await res.arrayBuffer())
        // The intake took 8 MB a file (apps/api routes/factory/intake.ts); the same ceiling as the owner's upload.
        if (raw.length > MAX_IMAGE_BYTES) throw new Error('larger than 8 MB')
        const name = decodeURIComponent(new URL(url).pathname.split('/').pop() || '').slice(0, 200) || null
        const row = await savePublicPhoto(deps, raw, { companyId, userId: null, originalName: name, tag: p.tag, alt: p.alt })
        if (!row) throw new Error('not an image')
        seeded++
      } catch (e: any) {
        errors.push({ url, error: e?.message || String(e) })
      }
    }
    return one(c, errors.length ? { seeded, errors } : { seeded })
  })
}

export function createSiteAdmin(deps: { db: any; permissions: any; store: PhotoStore; vertical: VerticalSettings }) {
  const { db, store } = deps
  const may = deps.permissions.requirePermission as (p: string) => any
  const app = new Hono<AppEnv>()

  /** The website's settings row, made the first time it's needed. */
  async function siteRow(companyId: string) {
    const [s] = await db.select().from(website).where(eq(website.companyId, companyId)).limit(1)
    if (s) return s
    const [created] = await db.insert(website).values({ companyId }).returning()
    return created
  }

  // ── Sections and pages ──────────────────────────────────────────────────
  app.get('/section-types', may('site:read'), (c) => {
    const dir = path.join(VIEWS, 'sections')
    const types: string[] = []
    for (const type of fs.readdirSync(dir)) {
      const sub = path.join(dir, type)
      if (!fs.statSync(sub).isDirectory()) continue
      for (const f of fs.readdirSync(sub)) {
        const key = type + '/' + f.replace(/\.ejs$/, '')
        if (f.endsWith('.ejs') && offersSection(key, deps.vertical)) types.push(key)
      }
    }
    types.sort()
    return list(c, types, allOf(types))
  })

  app.get('/pages', may('site:read'), async (c) => {
    const rows = await db.select({ id: page.id, slug: page.slug, title: page.title, isPublished: page.isPublished, navOrder: page.navOrder, updatedAt: page.updatedAt })
      .from(page).where(eq(page.companyId, c.get('user').companyId)).orderBy(asc(page.navOrder), asc(page.title))
    return list(c, rows, allOf(rows))
  })

  app.get('/pages/:slug', may('site:read'), async (c) => {
    const [p] = await db.select().from(page).where(and(eq(page.companyId, c.get('user').companyId), eq(page.slug, c.req.param('slug')))).limit(1)
    return p ? one(c, p) : fail(c, 404, 'Page not found')
  })

  app.post('/pages', may('site:update'), async (c) => {
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>
    const slug = String(body.slug || '').trim().toLowerCase()
    const title = String(body.title || '').trim()
    if (!slug) return fail(c, 400, 'slug is required')
    if (!title) return fail(c, 400, 'title is required')
    if (!SLUG_RE.test(slug)) return fail(c, 400, 'slug must be lowercase letters, numbers, and hyphens (e.g. "our-team")')
    if (RESERVED_SLUGS.has(slug)) return fail(c, 400, `"${slug}" is used by the site itself; choose another`)
    const companyId = c.get('user').companyId
    const [exists] = await db.select({ id: page.id }).from(page).where(and(eq(page.companyId, companyId), eq(page.slug, slug))).limit(1)
    if (exists) return fail(c, 409, 'A page with that slug already exists')
    const [created] = await db.insert(page).values({
      companyId, slug, title,
      sections: Array.isArray(body.sections) ? body.sections : [],
      isPublished: typeof body.isPublished === 'boolean' ? body.isPublished : true,
      navOrder: typeof body.navOrder === 'number' ? body.navOrder : 100,
      metaTitle: typeof body.metaTitle === 'string' ? body.metaTitle : null,
      metaDescription: typeof body.metaDescription === 'string' ? body.metaDescription : null,
    }).returning()
    return one(c, created, 201)
  })

  app.patch('/pages/:slug', may('site:update'), async (c) => {
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>
    const patch: Record<string, any> = {}
    if (typeof body.title === 'string' && body.title.trim()) patch.title = body.title.trim()
    if (Array.isArray(body.sections)) patch.sections = body.sections
    if (typeof body.metaTitle === 'string' || body.metaTitle === null) patch.metaTitle = body.metaTitle
    if (typeof body.metaDescription === 'string' || body.metaDescription === null) patch.metaDescription = body.metaDescription
    if (typeof body.isPublished === 'boolean') patch.isPublished = body.isPublished
    if (typeof body.navOrder === 'number' && Number.isFinite(body.navOrder)) patch.navOrder = Math.trunc(body.navOrder)
    if (!Object.keys(patch).length) return fail(c, 400, 'Nothing to change')
    patch.updatedAt = new Date()
    const [updated] = await db.update(page).set(patch).where(and(eq(page.companyId, c.get('user').companyId), eq(page.slug, c.req.param('slug')))).returning()
    return updated ? one(c, updated) : fail(c, 404, 'Page not found')
  })

  app.delete('/pages/:slug', may('site:delete'), async (c) => {
    const slug = c.req.param('slug')
    // The site's root route reads it; hiding (isPublished) is the way to take it down.
    if (slug === 'home') return fail(c, 400, "The home page can't be deleted. Unpublish it instead.")
    const gone = await db.delete(page).where(and(eq(page.companyId, c.get('user').companyId), eq(page.slug, slug))).returning({ id: page.id })
    return gone.length ? done(c) : fail(c, 404, 'Page not found')
  })

  // ── The website's settings ──────────────────────────────────────────────
  app.get('/settings', may('site:read'), async (c) => one(c, await siteRow(c.get('user').companyId)))

  /** The looks the site can wear; `isDefault` is the vertical's, which an empty site.design means. */
  app.get('/designs', may('site:read'), (c) => {
    const rows = SITE_DESIGNS.map((id) => ({ id, label: SITE_DESIGN_LABELS[id], isDefault: id === deps.vertical.site.design }))
    return list(c, rows, allOf(rows))
  })

  app.patch('/settings', may('site:settings'), async (c) => {
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>
    const patch: Record<string, any> = {}
    for (const [k, max] of SETTINGS_TEXT) {
      const v = optText(body[k as string], max)
      if (v !== undefined) patch[k as string] = v
    }
    if ('contactCtaLabel' in patch && !patch.contactCtaLabel) patch.contactCtaLabel = 'Get in touch'
    if ('nav' in body) {
      if (!Array.isArray(body.nav)) return fail(c, 400, 'nav must be a list of { label, href }')
      patch.nav = body.nav.slice(0, 20).map((n: any) => ({ label: String(n?.label ?? '').slice(0, 60), href: String(n?.href ?? '').slice(0, 300) })).filter((n) => n.label && n.href)
    }
    if ('contentGaps' in body) patch.contentGaps = Array.isArray(body.contentGaps) ? body.contentGaps.slice(0, 60) : []
    if ('serviceAreas' in body) patch.serviceAreas = Array.isArray(body.serviceAreas) ? body.serviceAreas.slice(0, 60).map((v: unknown) => String(v ?? '').slice(0, 80)) : []
    if ('inventoryFeedUrl' in body) {
      const v = String(body.inventoryFeedUrl ?? '').trim()
      if (v && !/^https:\/\/[^\s]+$/i.test(v)) return fail(c, 400, 'The inventory feed must be an https:// link.')
      patch.inventoryFeedUrl = v ? v.slice(0, 2000) : null
    }
    if ('design' in body) {
      if (body.design !== null && !(SITE_DESIGNS as readonly string[]).includes(String(body.design))) return fail(c, 400, 'Unknown design')
      patch.design = body.design
    }
    if (!Object.keys(patch).length) return fail(c, 400, 'Nothing to change')
    const row = await siteRow(c.get('user').companyId)
    const [updated] = await db.update(website).set({ ...patch, updatedAt: new Date() }).where(eq(website.id, row.id)).returning()
    return one(c, updated)
  })

  /**
   * "Finish your site" (web/src/site/components/FinishYourSiteCard.tsx): ticking an item off is content work — whoever may
   * edit the site's content may do it (a manager), without the site's settings (site:settings, owner and admin), which
   * the checklist used to save through and a manager was refused (live sweep, 2026-10-20). Only that item's tick changes.
   */
  app.post('/content-gaps/:id/done', may('site:update'), async (c) => {
    const row = await siteRow(c.get('user').companyId)
    const gaps: any[] = Array.isArray(row.contentGaps) ? row.contentGaps : []
    const id = c.req.param('id')
    if (!gaps.some((g) => g?.id === id)) return fail(c, 404, 'No such item')
    const contentGaps = gaps.map((g) => (g?.id === id ? { ...g, done: true } : g))
    const [updated] = await db.update(website).set({ contentGaps, updatedAt: new Date() }).where(eq(website.id, row.id)).returning()
    return one(c, { contentGaps: updated.contentGaps })
  })

  // ── Photos (the website's library: public photos) ────────────────────────
  app.get('/photos', may('site:read'), async (c) => {
    const tag = c.req.query('tag')
    const rows = await db.select().from(photo)
      .where(and(eq(photo.companyId, c.get('user').companyId), eq(photo.isPublic, true)))
      .orderBy(desc(photo.createdAt))
    const filtered = tag ? rows.filter((r: any) => Array.isArray(r.tags) && r.tags.includes(tag)) : rows
    return list(c, filtered, allOf(filtered))
  })

  app.post('/photos', may('site:update'), async (c) => {
    const body = await c.req.parseBody() as Record<string, any>
    const file = body.file as File | undefined
    if (!file || typeof (file as any).arrayBuffer !== 'function') return fail(c, 400, 'Choose a photo to upload.')
    if (file.size > MAX_IMAGE_BYTES) return fail(c, 400, 'That photo is too large (8 MB at most).')
    if (file.type && !IMAGE_TYPES.has(file.type)) return fail(c, 400, 'Use a JPG, PNG, WebP or GIF.')
    const user = c.get('user')
    const row = await savePublicPhoto({ db, store }, Buffer.from(await file.arrayBuffer()), {
      companyId: user.companyId, userId: user.userId, originalName: file.name || null, tag: body.tag, alt: body.alt,
    })
    return row ? one(c, row, 201) : fail(c, 400, "That file isn't an image we can read.")
  })

  app.patch('/photos/:id', may('site:update'), async (c) => {
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>
    const patch: Record<string, any> = {}
    if (typeof body.alt === 'string' || body.alt === null) patch.alt = body.alt ? String(body.alt).slice(0, 300) : null
    if (typeof body.tag === 'string' || body.tag === null) patch.tags = body.tag ? [String(body.tag).slice(0, 40)] : []
    if (!Object.keys(patch).length) return fail(c, 400, 'Nothing to change')
    const [updated] = await db.update(photo).set(patch)
      .where(and(eq(photo.id, c.req.param('id')), eq(photo.companyId, c.get('user').companyId), eq(photo.isPublic, true))).returning()
    return updated ? one(c, updated) : fail(c, 404, 'Photo not found')
  })

  app.delete('/photos/:id', may('site:delete'), async (c) => {
    const [gone] = await db.delete(photo)
      .where(and(eq(photo.id, c.req.param('id')), eq(photo.companyId, c.get('user').companyId), eq(photo.isPublic, true))).returning()
    if (!gone) return fail(c, 404, 'Photo not found')
    await store.remove(gone.filename).catch(() => {})
    return done(c)
  })

  // ── Blog ─────────────────────────────────────────────────────────────────
  app.get('/posts', may('site:read'), async (c) => {
    const rows = await db.select({ id: post.id, slug: post.slug, title: post.title, excerpt: post.excerpt, status: post.status, coverImageUrl: post.coverImageUrl, publishedAt: post.publishedAt, updatedAt: post.updatedAt })
      .from(post).where(eq(post.companyId, c.get('user').companyId)).orderBy(desc(post.createdAt))
    return list(c, rows, allOf(rows))
  })

  app.get('/posts/:slug', may('site:read'), async (c) => {
    const [p] = await db.select().from(post).where(and(eq(post.companyId, c.get('user').companyId), eq(post.slug, c.req.param('slug')))).limit(1)
    return p ? one(c, p) : fail(c, 404, 'Post not found')
  })

  app.post('/posts', may('site:update'), async (c) => {
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>
    const title = String(body.title || '').trim().slice(0, 200)
    const slug = String(body.slug || '').trim().toLowerCase()
    if (!title) return fail(c, 400, 'title is required')
    if (!POST_SLUG_RE.test(slug)) return fail(c, 400, 'slug must be lowercase letters, numbers, and hyphens')
    const companyId = c.get('user').companyId
    const [exists] = await db.select({ id: post.id }).from(post).where(and(eq(post.companyId, companyId), eq(post.slug, slug))).limit(1)
    if (exists) return fail(c, 409, 'A post with that slug already exists')
    const published = body.status === 'published'
    const [created] = await db.insert(post).values({
      companyId, slug, title,
      excerpt: optText(body.excerpt, 600) ?? null,
      body: typeof body.body === 'string' ? body.body : '',
      coverImageUrl: optText(body.coverImageUrl, 2000) ?? null,
      status: published ? 'published' : 'draft',
      publishedAt: published ? new Date() : null,
    }).returning()
    return one(c, created, 201)
  })

  app.patch('/posts/:slug', may('site:update'), async (c) => {
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>
    const where = and(eq(post.companyId, c.get('user').companyId), eq(post.slug, c.req.param('slug')))
    const patch: Record<string, any> = {}
    if (typeof body.title === 'string' && body.title.trim()) patch.title = body.title.trim().slice(0, 200)
    for (const [k, max] of [['excerpt', 600], ['coverImageUrl', 2000], ['metaTitle', 200], ['metaDescription', 400]] as const) {
      const v = optText(body[k], max)
      if (v !== undefined) patch[k] = v
    }
    if (typeof body.body === 'string') patch.body = body.body
    if (body.status === 'draft' || body.status === 'published') {
      patch.status = body.status
      if (body.status === 'published') {
        const [existing] = await db.select({ publishedAt: post.publishedAt }).from(post).where(where).limit(1)
        if (existing && !existing.publishedAt) patch.publishedAt = new Date()
      }
    }
    if (!Object.keys(patch).length) return fail(c, 400, 'Nothing to change')
    const [updated] = await db.update(post).set({ ...patch, updatedAt: new Date() }).where(where).returning()
    return updated ? one(c, updated) : fail(c, 404, 'Post not found')
  })

  app.delete('/posts/:slug', may('site:delete'), async (c) => {
    const gone = await db.delete(post).where(and(eq(post.companyId, c.get('user').companyId), eq(post.slug, c.req.param('slug')))).returning({ id: post.id })
    return gone.length ? done(c) : fail(c, 404, 'Post not found')
  })

  // ── Portfolio (the site's "projects") ───────────────────────────────────
  const photoList = (v: unknown): string[] => (Array.isArray(v) ? v : []).map((u) => String(u ?? '').trim()).filter((u) => u && u.length <= 2000).slice(0, 40)

  /** The first published piece of work puts "Projects" in the site's nav, once; the owner can take it out. */
  async function ensurePortfolioInNav(companyId: string) {
    const s = await siteRow(companyId)
    const nav = Array.isArray(s.nav) ? s.nav as Array<{ label: string; href: string }> : []
    if (nav.some((n) => /^\/?projects\/?$/.test(String(n?.href || '')))) return
    await db.update(website).set({ nav: [...nav, { label: 'Projects', href: '/projects' }], updatedAt: new Date() }).where(eq(website.id, s.id))
  }

  app.get('/portfolio', may('site:read'), async (c) => {
    const rows = await db.select({ id: portfolioItem.id, slug: portfolioItem.slug, title: portfolioItem.title, location: portfolioItem.location, status: portfolioItem.status, coverImageUrl: portfolioItem.coverImageUrl, sortOrder: portfolioItem.sortOrder, updatedAt: portfolioItem.updatedAt })
      .from(portfolioItem).where(eq(portfolioItem.companyId, c.get('user').companyId)).orderBy(asc(portfolioItem.sortOrder), desc(portfolioItem.createdAt))
    return list(c, rows, allOf(rows))
  })

  app.get('/portfolio/:slug', may('site:read'), async (c) => {
    const [p] = await db.select().from(portfolioItem).where(and(eq(portfolioItem.companyId, c.get('user').companyId), eq(portfolioItem.slug, c.req.param('slug')))).limit(1)
    return p ? one(c, p) : fail(c, 404, 'Not found')
  })

  app.post('/portfolio', may('site:update'), async (c) => {
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>
    const title = String(body.title || '').trim().slice(0, 200)
    const slug = String(body.slug || '').trim().toLowerCase()
    if (!title) return fail(c, 400, 'title is required')
    if (!POST_SLUG_RE.test(slug)) return fail(c, 400, 'The address must be lowercase letters, numbers, and hyphens')
    const companyId = c.get('user').companyId
    const [exists] = await db.select({ id: portfolioItem.id }).from(portfolioItem).where(and(eq(portfolioItem.companyId, companyId), eq(portfolioItem.slug, slug))).limit(1)
    if (exists) return fail(c, 409, 'A project with that address already exists')
    const published = body.status === 'published'
    const [created] = await db.insert(portfolioItem).values({
      companyId, slug, title,
      location: optText(body.location, 200) ?? null,
      summary: optText(body.summary, 600) ?? null,
      body: typeof body.body === 'string' ? body.body : '',
      coverImageUrl: optText(body.coverImageUrl, 2000) ?? null,
      photos: photoList(body.photos),
      status: published ? 'published' : 'draft',
      publishedAt: published ? new Date() : null,
    }).returning()
    if (published) await ensurePortfolioInNav(companyId)
    return one(c, created, 201)
  })

  app.patch('/portfolio/:slug', may('site:update'), async (c) => {
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>
    const companyId = c.get('user').companyId
    const where = and(eq(portfolioItem.companyId, companyId), eq(portfolioItem.slug, c.req.param('slug')))
    const patch: Record<string, any> = {}
    if (typeof body.title === 'string' && body.title.trim()) patch.title = body.title.trim().slice(0, 200)
    for (const [k, max] of [['location', 200], ['summary', 600], ['coverImageUrl', 2000], ['metaTitle', 200], ['metaDescription', 400]] as const) {
      const v = optText(body[k], max)
      if (v !== undefined) patch[k] = v
    }
    if (typeof body.body === 'string') patch.body = body.body
    if ('photos' in body) patch.photos = photoList(body.photos)
    if (typeof body.sortOrder === 'number' && Number.isFinite(body.sortOrder)) patch.sortOrder = Math.trunc(body.sortOrder)
    let publishing = false
    if (body.status === 'draft' || body.status === 'published') {
      patch.status = body.status
      if (body.status === 'published') {
        publishing = true
        const [existing] = await db.select({ publishedAt: portfolioItem.publishedAt }).from(portfolioItem).where(where).limit(1)
        if (existing && !existing.publishedAt) patch.publishedAt = new Date()
      }
    }
    if (!Object.keys(patch).length) return fail(c, 400, 'Nothing to change')
    const [updated] = await db.update(portfolioItem).set({ ...patch, updatedAt: new Date() }).where(where).returning()
    if (!updated) return fail(c, 404, 'Not found')
    if (publishing) await ensurePortfolioInNav(companyId)
    return one(c, updated)
  })

  app.delete('/portfolio/:slug', may('site:delete'), async (c) => {
    const gone = await db.delete(portfolioItem).where(and(eq(portfolioItem.companyId, c.get('user').companyId), eq(portfolioItem.slug, c.req.param('slug')))).returning({ id: portfolioItem.id })
    return gone.length ? done(c) : fail(c, 404, 'Not found')
  })

  // ── Visits and enquiries, last 30 days against the 30 before ─────────────
  app.get('/analytics', may('site:read'), async (c) => {
    const companyId = c.get('user').companyId
    const day = (d: Date) => d.toISOString().slice(0, 10)
    const now = Date.now()
    const d30 = day(new Date(now - 30 * 864e5)), d60 = day(new Date(now - 60 * 864e5))
    const views = await db.select().from(pageView).where(and(eq(pageView.companyId, companyId), gte(pageView.day, d60)))
    let viewsLast30 = 0, viewsPrev30 = 0
    const byPath: Record<string, number> = {}
    for (const v of views) {
      if (v.day >= d30) { viewsLast30 += v.count; byPath[v.path] = (byPath[v.path] || 0) + v.count } else viewsPrev30 += v.count
    }
    const topPages = Object.entries(byPath).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([p, count]) => ({ path: p, count }))
    // An enquiry is a website lead in the inbox, or a lead contact where the inbox is off (core/enquiry.ts).
    const since = new Date(now - 60 * 864e5), cut = new Date(now - 30 * 864e5)
    const inbox = await db.select({ at: lead.receivedAt }).from(lead).where(and(eq(lead.companyId, companyId), eq(lead.sourcePlatform, 'website'), gte(lead.receivedAt, since)))
    const contacts = await db.select({ at: contact.createdAt }).from(contact).where(and(eq(contact.companyId, companyId), inArray(contact.type, ['lead']), gte(contact.createdAt, since)))
    let leadsLast30 = 0, leadsPrev30 = 0
    for (const r of [...inbox, ...contacts]) { if (r.at >= cut) leadsLast30++; else leadsPrev30++ }
    return one(c, { viewsLast30, viewsPrev30, leadsLast30, leadsPrev30, topPages })
  })

  return app
}
