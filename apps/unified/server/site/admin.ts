// The website's admin API (/api/site): its pages, settings, photos, blog, portfolio and visit numbers. Moved from the
// premium site's routes/admin.ts, with three changes:
//   • Every action checks a permission (site:read, site:update, site:delete; settings site:settings). The site's
//     routes only checked that someone was signed in, so any signed-in person could change the site's settings.
//   • Replies in the rulebook's shapes (§3) instead of wrappers ({ pages }, { page }…).
//   • The company's own facts (name, phone, email, address, colours, logo) are edited in one place, the company
//     settings (/api/company); this edits what is the website's alone.
// Bookings move with the one booking engine (step 2d); the customize link with the admin screens.
//
// Draft and live (site/drafts.ts, 2026-10-23): saving a page, a post, a piece of work or the settings keeps a draft; only
// …/publish changes what visitors see, and DELETE …/draft goes back to the live version. Who may publish is who may save
// it: site:update for content, site:settings for the settings — the same people who, before drafts, changed the live
// site by saving. Showing or hiding a page or a post (isPublished, status) is its own switch and takes effect at once.
import { Hono } from 'hono'
import { and, asc, desc, eq, gte, inArray, isNotNull } from 'drizzle-orm'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import sharp from 'sharp'
import { createFileStorage, companyTimeZone, storeDateString, siteSectionFeature } from '@twomiah/tenant-backend'
import { website, page, post, portfolioItem, photo, pageView, lead, contact, company } from '../db/schema/index.ts'
import { SITE_DESIGNS, SITE_DESIGN_LABELS, SITE_DESIGN_SPECS, type VerticalSettings } from '../core/vertical.ts'
import { cleanHex, cleanPalette, PRESETS } from './palette.ts'
import { cleanStyle, FONT_PAIRS } from './feel.ts'
import { DEFAULT_ACCENT } from '../core/brandColour.ts'
import { one, fail, done, listAll } from '../http/reply.ts'
import type { AppEnv } from '../http/env.ts'
import { RESERVED_SLUGS, SLUG_RE } from './slugs.ts'
import { VIEWS } from './render.ts'
import { linkSlug } from './menu.ts'
import { tradeDrawsSection } from './tradeSections.ts'
import { PAGE_DRAFT, POST_DRAFT, PORTFOLIO_DRAFT, SETTINGS_DRAFT, draftOf, nextDraft, withDraft } from './drafts.ts'
import { addPreviewRoutes, type PreviewDeps } from './preview.ts'
import { publishSet } from '../data/siteDrafts.ts'

/** Where public website photos are kept: the one prefix /media serves (site/routes.ts). */
export const PUBLIC_PHOTO_PREFIX = 'photos/'

/** The file store, injectable so a test can stand one in (production: the shared R2 storage). */
export interface PhotoStore {
  put(key: string, body: Buffer, contentType: string): Promise<void>
  getObject(key: string): Promise<{ body: ArrayBuffer | Uint8Array | Buffer; contentType: string } | null>
  remove(key: string): Promise<void>
}

/** The business's own file storage (R2, from the service's settings) as the website's photo store — the app's, and the move's. */
export function sharedPhotoStore(): PhotoStore {
  const s = createFileStorage()
  return { put: (k, b, t) => s.put(k, b, t), getObject: (k) => s.getObject(k), remove: async (k) => { s.deleteFile(k) } }
}

// Sections the server fills in itself (live menu, inventory, portfolio, service areas, tools, a bar's signature-item page,
// which the bar's facts make at /<menu-section>/<item>) aren't offered in "Add a section".
// A store's product page, cart and order-received page, and pickup ordering's page and its done page, are the routes' own
// (site/routes.ts /product/:slug, /cart, /checkout/success, /order, /order/done).
export const SERVER_BUILT_SECTIONS = new Set(['areas/list', 'service/detail', 'service/others', 'projects/grid', 'projects/detail', 'menu/live', 'menu/item-hero', 'inventory/live', 'inventory/unit', 'tools/visualizer', 'tools/estimator',
  'shop/product', 'shop/cart', 'shop/receipt', 'order/page', 'order/done'])

/**
 * Sections that work only on a vertical's own add-on, and are offered only to a vertical that has it: the ones that read
 * the live facts (`site`/`live`, SiteSettings.facts — the bar's night, menu, taps, hours, events, story, speakeasy door)
 * and the forms only that vertical's CRM takes (CrmSettings.websiteForms — the bar's party request and Regulars sign-up).
 * On any other site they would draw an empty board or post a form nothing is waiting for. Every other section is the
 * whole library's (tests/site-section-fields.test.ts holds every view that reads `site`/`live` to an entry here).
 */
export const ADDON_SECTIONS: Record<string, { facts?: 'bar' | Array<'bar' | 'menu'>; websiteForms?: 'bar' }> = {
  'tonight/board': { facts: 'bar' }, 'taps/wall': { facts: 'bar' }, 'menu/sections': { facts: ['bar', 'menu'] }, 'hours/table': { facts: 'bar' },
  'events/list': { facts: 'bar' }, 'speakeasy/door': { facts: 'bar' },
  'timeline/eras': { facts: 'bar' }, 'timeline/era': { facts: 'bar' }, 'timeline/book': { facts: 'bar' },
  'regulars/signup': { facts: 'bar', websiteForms: 'bar' }, 'parties/inquiry-form': { websiteForms: 'bar' },
}

/** Whether this vertical's site can draw a section of the library. */
export function offersSection(key: string, vertical: VerticalSettings): boolean {
  if (SERVER_BUILT_SECTIONS.has(key)) return false
  // Another trade's section (an age gate, a care finder, a storm alert on a store) is not this business's (tradeSections.ts).
  if (!tradeDrawsSection(key.split('/')[0], vertical.id)) return false
  const needs = ADDON_SECTIONS[key]
  if (!needs) return true
  const factsOk = !needs.facts || (Array.isArray(needs.facts) ? needs.facts.includes(vertical.site.facts as any) : vertical.site.facts === needs.facts)
  return factsOk && (!needs.websiteForms || vertical.crm?.websiteForms === needs.websiteForms)
}
const POST_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,80}[a-z0-9])?$/
export const IMAGE_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'])
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const optText = (v: unknown, max: number) => (typeof v === 'string' ? (v.trim() ? v.slice(0, max) : null) : v === null ? null : undefined)

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

export function createSiteAdmin(deps: { db: any; permissions: any; store: PhotoStore; vertical: VerticalSettings; preview?: Omit<PreviewDeps, 'db' | 'vertical' | 'hasPermission'> }) {
  const { db, store } = deps
  const may = deps.permissions.requirePermission as (p: string) => any
  const app = new Hono<AppEnv>()
  const hasPermission = async (c: any, permission: string) => {
    const user = c.get('user')
    return !!user && deps.permissions.hasPermission(user.role, permission, await deps.permissions.getExtraPermissions(user.userId))
  }
  if (deps.preview) addPreviewRoutes(app, may, { db, vertical: deps.vertical, hasPermission, ...deps.preview })

  /** The website's settings row, made the first time it's needed. */
  async function siteRow(companyId: string) {
    const [s] = await db.select().from(website).where(eq(website.companyId, companyId)).limit(1)
    if (s) return s
    const [created] = await db.insert(website).values({ companyId }).returning()
    return created
  }

  // ── Sections and pages ──────────────────────────────────────────────────
  app.get('/section-types', may('site:read'), async (c) => {
    const dir = path.join(VIEWS, 'sections')
    const types: string[] = []
    // A section that IS a feature (the financing calculator) is offered only to a business with that feature on — the
    // site would not show it otherwise (render.ts sectionsShown).
    const [co] = await db.select({ f: company.enabledFeatures }).from(company).where(eq(company.id, (c.get('user') as any).companyId)).limit(1)
    const on = new Set<string>(Array.isArray(co?.f) ? co.f : [])
    for (const type of fs.readdirSync(dir)) {
      const sub = path.join(dir, type)
      if (!fs.statSync(sub).isDirectory()) continue
      for (const f of fs.readdirSync(sub)) {
        const key = type + '/' + f.replace(/\.ejs$/, '')
        const feature = siteSectionFeature(type)
        if (f.endsWith('.ejs') && offersSection(key, deps.vertical) && (!feature || on.has(feature))) types.push(key)
      }
    }
    types.sort()
    return listAll(c, types)
  })

  /**
   * A page the owner publishes joins the site's menu, once — as the first published piece of work adds Projects
   * (ensurePortfolioInNav). Taken out of the menu afterwards, it stays out while it stays published (a landing page).
   * The home page is the logo and the contact page the header's button, so neither is added. (Live test 2026-10-22:
   * a page shown on the site never reached the menu.)
   */
  async function ensurePageInNav(companyId: string, p: { slug: string; title: string }) {
    if (p.slug === 'home' || p.slug === 'contact') return
    const s = await siteRow(companyId)
    const nav = Array.isArray(s.nav) ? s.nav as Array<{ label: string; href: string }> : []
    if (nav.some((n) => linkSlug(n?.href) === p.slug)) return
    await addToNav(s, { label: p.title, href: p.slug }, (n) => linkSlug(n?.href) === p.slug)
  }

  /**
   * A link the site adds to its menu by itself goes into the live menu — and into the draft settings' menu when there
   * are draft settings, which publishing would otherwise put back without it.
   */
  async function addToNav(s: any, item: { label: string; href: string }, has: (n: any) => boolean) {
    const nav = Array.isArray(s.nav) ? s.nav as Array<{ label: string; href: string }> : []
    const set: Record<string, unknown> = { nav: [...nav, item], updatedAt: new Date() }
    const draft = draftOf(s)
    if (draft && Array.isArray(draft.nav) && !(draft.nav as any[]).some(has)) set.draft = { ...draft, nav: [...(draft.nav as any[]), item] }
    await db.update(website).set(set).where(eq(website.id, s.id))
  }

  /** Whether each listed record has unpublished changes (not the draft itself: a list carries no page bodies). */
  const flagDrafts = (rows: any[]) => rows.map(({ draft, ...r }) => ({ ...r, hasDraft: !!draftOf({ draft }) }))

  app.get('/pages', may('site:read'), async (c) => {
    const rows = await db.select({ id: page.id, slug: page.slug, title: page.title, isPublished: page.isPublished, navOrder: page.navOrder, updatedAt: page.updatedAt, draft: page.draft })
      .from(page).where(eq(page.companyId, c.get('user').companyId)).orderBy(asc(page.navOrder), asc(page.title))
    return listAll(c, flagDrafts(rows))
  })

  app.get('/pages/:slug', may('site:read'), async (c) => {
    const [p] = await db.select().from(page).where(and(eq(page.companyId, c.get('user').companyId), eq(page.slug, c.req.param('slug')))).limit(1)
    return p ? one(c, withDraft(p)) : fail(c, 404, 'Page not found')
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
    if (created.isPublished) await ensurePageInNav(companyId, created)
    return one(c, withDraft(created), 201)
  })

  /**
   * Saving a page: its words, sections and search tags go into the draft (site/drafts.ts) — the live page is untouched.
   * Whether it is shown (isPublished) and its place in the list (navOrder) change at once: they are switches, not content.
   */
  app.patch('/pages/:slug', may('site:update'), async (c) => {
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>
    const content: Record<string, unknown> = {}
    if (typeof body.title === 'string' && body.title.trim()) content.title = body.title.trim()
    if (Array.isArray(body.sections)) content.sections = body.sections
    if (typeof body.metaTitle === 'string' || body.metaTitle === null) content.metaTitle = body.metaTitle
    if (typeof body.metaDescription === 'string' || body.metaDescription === null) content.metaDescription = body.metaDescription
    const now: Record<string, any> = {}
    if (typeof body.isPublished === 'boolean') now.isPublished = body.isPublished
    if (typeof body.navOrder === 'number' && Number.isFinite(body.navOrder)) now.navOrder = Math.trunc(body.navOrder)
    if (!Object.keys(content).length && !Object.keys(now).length) return fail(c, 400, 'Nothing to change')
    const companyId = c.get('user').companyId
    const where = and(eq(page.companyId, companyId), eq(page.slug, c.req.param('slug')))
    const [before] = await db.select().from(page).where(where).limit(1)
    if (!before) return fail(c, 404, 'Page not found')
    const set: Record<string, any> = { ...now }
    if (Object.keys(content).length) set.draft = nextDraft(before, PAGE_DRAFT, content)
    // The live page changed only if a switch did: the sitemap's date is the live page's.
    if (Object.keys(now).length) set.updatedAt = new Date()
    const [updated] = await db.update(page).set(set).where(where).returning()
    if (!updated) return fail(c, 404, 'Page not found')
    if (updated.isPublished && !before.isPublished) await ensurePageInNav(companyId, updated)
    return one(c, withDraft(updated))
  })

  /**
   * Publish: the draft becomes the live page. `show: true` also shows a hidden page — the editor offers it for a page
   * held back while it had nothing on it (PageEditPage), so publishing its first content puts it on the site and in the
   * menu, as saving it used to.
   */
  app.post('/pages/:slug/publish', may('site:update'), async (c) => {
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>
    const companyId = c.get('user').companyId
    const where = and(eq(page.companyId, companyId), eq(page.slug, c.req.param('slug')))
    const [before] = await db.select().from(page).where(where).limit(1)
    if (!before) return fail(c, 404, 'Page not found')
    const show = body.show === true && !before.isPublished
    if (!draftOf(before) && !show) return fail(c, 409, 'There are no unpublished changes on this page.', 'nothing_to_publish')
    const set: Record<string, unknown> = { ...publishSet(page, PAGE_DRAFT, new Set(['sections']), new Set(['title', 'sections'])), updatedAt: new Date() }
    if (show) set.isPublished = true
    const [updated] = await db.update(page).set(set).where(where).returning()
    if (!updated) return fail(c, 404, 'Page not found')
    if (updated.isPublished && !before.isPublished) await ensurePageInNav(companyId, updated)
    return one(c, withDraft(updated))
  })

  /** Discard: the page's unpublished changes are dropped; the editor goes back to the live page. */
  app.delete('/pages/:slug/draft', may('site:update'), async (c) => {
    const [updated] = await db.update(page).set({ draft: null })
      .where(and(eq(page.companyId, c.get('user').companyId), eq(page.slug, c.req.param('slug')))).returning()
    return updated ? one(c, withDraft(updated)) : fail(c, 404, 'Page not found')
  })

  app.delete('/pages/:slug', may('site:delete'), async (c) => {
    const slug = c.req.param('slug')
    // The site's root route reads it; hiding (isPublished) is the way to take it down.
    if (slug === 'home') return fail(c, 400, "The home page can't be deleted. Unpublish it instead.")
    const gone = await db.delete(page).where(and(eq(page.companyId, c.get('user').companyId), eq(page.slug, slug))).returning({ id: page.id })
    return gone.length ? done(c) : fail(c, 404, 'Page not found')
  })

  // ── The website's settings ──────────────────────────────────────────────
  app.get('/settings', may('site:read'), async (c) => one(c, withDraft(await siteRow(c.get('user').companyId))))

  /** The looks the site can wear; `isDefault` is the vertical's, which an empty site.design means. */
  app.get('/designs', may('site:read'), (c) => {
    const rows = SITE_DESIGNS.map((id) => ({ id, label: SITE_DESIGN_LABELS[id], isDefault: id === deps.vertical.site.design }))
    return listAll(c, rows)
  })

  /** The palette presets, and for each design whether the owner's page ground and dark band can be set on it. */
  app.get('/palettes', may('site:read'), async (c) => {
    const designs = Object.fromEntries(SITE_DESIGNS.map((id) => [id, { page: SITE_DESIGN_SPECS[id].tokens !== 'bar' }]))
    const [co] = await db.select({ primaryColor: company.primaryColor, secondaryColor: company.secondaryColor }).from(company).where(eq(company.id, c.get('user').companyId)).limit(1)
    // What an empty brand, accent and band mean: the business's own colours, and the designs' amber.
    return one(c, { presets: PRESETS, fonts: FONT_PAIRS.map(({ id, label, display, body, blurb }) => ({ id, label, display, body, blurb })), designs, defaults: { brand: co?.primaryColor ?? null, band: co?.secondaryColor ?? null, accent: DEFAULT_ACCENT } })
  })

  app.patch('/settings', may('site:settings'), async (c) => {
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>
    const patch: Record<string, any> = {}
    if ('palette' in body) {
      if (body.palette !== null && (typeof body.palette !== 'object' || Array.isArray(body.palette))) return fail(c, 400, 'palette must be { brand, band, page } or null')
      const raw = (body.palette ?? {}) as Record<string, unknown>
      for (const k of ['brand', 'band', 'page'] as const) if (raw[k] != null && raw[k] !== '' && !cleanHex(raw[k])) return fail(c, 400, `The ${k} colour must look like #1f6b46.`)
      patch.palette = cleanPalette(body.palette)
    }
    if ('style' in body) {
      if (body.style !== null && (typeof body.style !== 'object' || Array.isArray(body.style))) return fail(c, 400, 'style must be { fonts, corners, buttons, spacing } or null')
      const raw = (body.style ?? {}) as Record<string, unknown>
      const clean = cleanStyle(body.style) ?? {}
      for (const k of Object.keys(raw)) if (raw[k] != null && raw[k] !== '' && !(k in clean)) return fail(c, 400, `The ${k} choice is not one of the offered ones.`)
      patch.style = cleanStyle(body.style)
    }
    if ('accentColor' in body && body.accentColor != null && body.accentColor !== '' && !cleanHex(body.accentColor)) return fail(c, 400, 'The accent colour must look like #c89a4e.')
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
    // What the site shows goes into the draft settings (site/drafts.ts); the "Finish your site" list is the owner's own.
    const content: Record<string, unknown> = {}
    const set: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(patch)) ((SETTINGS_DRAFT as readonly string[]).includes(k) ? content : set)[k] = v
    if (Object.keys(set).length) set.updatedAt = new Date()
    if (Object.keys(content).length) set.draft = nextDraft(row, SETTINGS_DRAFT, content)
    const [updated] = await db.update(website).set(set).where(eq(website.id, row.id)).returning()
    return one(c, withDraft(updated))
  })

  /** Publish the draft settings: the site's look, menu, words and tracking change for visitors. */
  app.post('/settings/publish', may('site:settings'), async (c) => {
    const row = await siteRow(c.get('user').companyId)
    if (!draftOf(row)) return fail(c, 409, 'There are no unpublished changes to the settings.', 'nothing_to_publish')
    const [updated] = await db.update(website)
      .set({ ...publishSet(website, SETTINGS_DRAFT, new Set(['nav', 'serviceAreas', 'palette', 'style']), new Set(['nav', 'serviceAreas', 'contactCtaLabel'])), updatedAt: new Date() })
      .where(eq(website.id, row.id)).returning()
    return one(c, withDraft(updated))
  })

  /** Discard the draft settings: the editor goes back to what the site shows. */
  app.delete('/settings/draft', may('site:settings'), async (c) => {
    const row = await siteRow(c.get('user').companyId)
    const [updated] = await db.update(website).set({ draft: null }).where(eq(website.id, row.id)).returning()
    return one(c, withDraft(updated))
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
    return listAll(c, filtered)
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
    const rows = await db.select({ id: post.id, slug: post.slug, title: post.title, excerpt: post.excerpt, status: post.status, coverImageUrl: post.coverImageUrl, publishedAt: post.publishedAt, updatedAt: post.updatedAt, draft: post.draft })
      .from(post).where(eq(post.companyId, c.get('user').companyId)).orderBy(desc(post.createdAt))
    return listAll(c, flagDrafts(rows))
  })

  app.get('/posts/:slug', may('site:read'), async (c) => {
    const [p] = await db.select().from(post).where(and(eq(post.companyId, c.get('user').companyId), eq(post.slug, c.req.param('slug')))).limit(1)
    return p ? one(c, withDraft(p)) : fail(c, 404, 'Post not found')
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
    return one(c, withDraft(created), 201)
  })

  /**
   * Saving a post: its words and pictures go into the draft (site/drafts.ts). `status` — on the site or not — is the
   * post's "Show on site" switch and changes at once.
   */
  app.patch('/posts/:slug', may('site:update'), async (c) => {
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>
    const where = and(eq(post.companyId, c.get('user').companyId), eq(post.slug, c.req.param('slug')))
    const content: Record<string, any> = {}
    if (typeof body.title === 'string' && body.title.trim()) content.title = body.title.trim().slice(0, 200)
    for (const [k, max] of [['excerpt', 600], ['coverImageUrl', 2000], ['metaTitle', 200], ['metaDescription', 400]] as const) {
      const v = optText(body[k], max)
      if (v !== undefined) content[k] = v
    }
    if (typeof body.body === 'string') content.body = body.body
    const [before] = await db.select().from(post).where(where).limit(1)
    if (!before) return fail(c, 404, 'Post not found')
    const set: Record<string, any> = {}
    if (body.status === 'draft' || body.status === 'published') {
      set.status = body.status
      if (body.status === 'published' && !before.publishedAt) set.publishedAt = new Date()
      set.updatedAt = new Date()
    }
    if (Object.keys(content).length) set.draft = nextDraft(before, POST_DRAFT, content)
    if (!Object.keys(set).length) return fail(c, 400, 'Nothing to change')
    const [updated] = await db.update(post).set(set).where(where).returning()
    return updated ? one(c, withDraft(updated)) : fail(c, 404, 'Post not found')
  })

  /** Publish the post's draft; `show: true` also puts a post that is off the site on it. */
  app.post('/posts/:slug/publish', may('site:update'), async (c) => {
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>
    const where = and(eq(post.companyId, c.get('user').companyId), eq(post.slug, c.req.param('slug')))
    const [before] = await db.select().from(post).where(where).limit(1)
    if (!before) return fail(c, 404, 'Post not found')
    const show = body.show === true && before.status !== 'published'
    if (!draftOf(before) && !show) return fail(c, 409, 'There are no unpublished changes on this post.', 'nothing_to_publish')
    const set: Record<string, unknown> = { ...publishSet(post, POST_DRAFT, new Set(), new Set(['title', 'body'])), updatedAt: new Date() }
    if (show) { set.status = 'published'; if (!before.publishedAt) set.publishedAt = new Date() }
    const [updated] = await db.update(post).set(set).where(where).returning()
    return updated ? one(c, withDraft(updated)) : fail(c, 404, 'Post not found')
  })

  /** Discard the post's unpublished changes. */
  app.delete('/posts/:slug/draft', may('site:update'), async (c) => {
    const [updated] = await db.update(post).set({ draft: null })
      .where(and(eq(post.companyId, c.get('user').companyId), eq(post.slug, c.req.param('slug')))).returning()
    return updated ? one(c, withDraft(updated)) : fail(c, 404, 'Post not found')
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
    const isProjects = (n: any) => /^\/?projects\/?$/.test(String(n?.href || ''))
    if (nav.some(isProjects)) return
    await addToNav(s, { label: 'Projects', href: '/projects' }, isProjects)
  }

  app.get('/portfolio', may('site:read'), async (c) => {
    const rows = await db.select({ id: portfolioItem.id, slug: portfolioItem.slug, title: portfolioItem.title, location: portfolioItem.location, status: portfolioItem.status, coverImageUrl: portfolioItem.coverImageUrl, sortOrder: portfolioItem.sortOrder, updatedAt: portfolioItem.updatedAt, draft: portfolioItem.draft })
      .from(portfolioItem).where(eq(portfolioItem.companyId, c.get('user').companyId)).orderBy(asc(portfolioItem.sortOrder), desc(portfolioItem.createdAt))
    return listAll(c, flagDrafts(rows))
  })

  app.get('/portfolio/:slug', may('site:read'), async (c) => {
    const [p] = await db.select().from(portfolioItem).where(and(eq(portfolioItem.companyId, c.get('user').companyId), eq(portfolioItem.slug, c.req.param('slug')))).limit(1)
    return p ? one(c, withDraft(p)) : fail(c, 404, 'Not found')
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
    return one(c, withDraft(created), 201)
  })

  /** Saving a piece of work: its words and photos into the draft; its status (shown or not) and its order at once. */
  app.patch('/portfolio/:slug', may('site:update'), async (c) => {
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>
    const companyId = c.get('user').companyId
    const where = and(eq(portfolioItem.companyId, companyId), eq(portfolioItem.slug, c.req.param('slug')))
    const content: Record<string, any> = {}
    if (typeof body.title === 'string' && body.title.trim()) content.title = body.title.trim().slice(0, 200)
    for (const [k, max] of [['location', 200], ['summary', 600], ['coverImageUrl', 2000], ['metaTitle', 200], ['metaDescription', 400]] as const) {
      const v = optText(body[k], max)
      if (v !== undefined) content[k] = v
    }
    if (typeof body.body === 'string') content.body = body.body
    if ('photos' in body) content.photos = photoList(body.photos)
    const [before] = await db.select().from(portfolioItem).where(where).limit(1)
    if (!before) return fail(c, 404, 'Not found')
    const set: Record<string, any> = {}
    if (typeof body.sortOrder === 'number' && Number.isFinite(body.sortOrder)) set.sortOrder = Math.trunc(body.sortOrder)
    let showing = false
    if (body.status === 'draft' || body.status === 'published') {
      set.status = body.status
      if (body.status === 'published') {
        showing = true
        if (!before.publishedAt) set.publishedAt = new Date()
      }
    }
    if (Object.keys(set).length) set.updatedAt = new Date()
    if (Object.keys(content).length) set.draft = nextDraft(before, PORTFOLIO_DRAFT, content)
    if (!Object.keys(set).length) return fail(c, 400, 'Nothing to change')
    const [updated] = await db.update(portfolioItem).set(set).where(where).returning()
    if (!updated) return fail(c, 404, 'Not found')
    if (showing) await ensurePortfolioInNav(companyId)
    return one(c, withDraft(updated))
  })

  /** Publish the work's draft; `show: true` also puts work that is off the site on it (and Projects in the menu). */
  app.post('/portfolio/:slug/publish', may('site:update'), async (c) => {
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>
    const companyId = c.get('user').companyId
    const where = and(eq(portfolioItem.companyId, companyId), eq(portfolioItem.slug, c.req.param('slug')))
    const [before] = await db.select().from(portfolioItem).where(where).limit(1)
    if (!before) return fail(c, 404, 'Not found')
    const show = body.show === true && before.status !== 'published'
    if (!draftOf(before) && !show) return fail(c, 409, 'There are no unpublished changes on this project.', 'nothing_to_publish')
    const set: Record<string, unknown> = { ...publishSet(portfolioItem, PORTFOLIO_DRAFT, new Set(['photos']), new Set(['title', 'body', 'photos'])), updatedAt: new Date() }
    if (show) { set.status = 'published'; if (!before.publishedAt) set.publishedAt = new Date() }
    const [updated] = await db.update(portfolioItem).set(set).where(where).returning()
    if (!updated) return fail(c, 404, 'Not found')
    if (show) await ensurePortfolioInNav(companyId)
    return one(c, withDraft(updated))
  })

  /** Discard the work's unpublished changes. */
  app.delete('/portfolio/:slug/draft', may('site:update'), async (c) => {
    const [updated] = await db.update(portfolioItem).set({ draft: null })
      .where(and(eq(portfolioItem.companyId, c.get('user').companyId), eq(portfolioItem.slug, c.req.param('slug')))).returning()
    return updated ? one(c, withDraft(updated)) : fail(c, 404, 'Not found')
  })

  app.delete('/portfolio/:slug', may('site:delete'), async (c) => {
    const gone = await db.delete(portfolioItem).where(and(eq(portfolioItem.companyId, c.get('user').companyId), eq(portfolioItem.slug, c.req.param('slug')))).returning({ id: portfolioItem.id })
    return gone.length ? done(c) : fail(c, 404, 'Not found')
  })

  // ── Everything unpublished, and Publish all (owner 2026-10-23, as Wix and Webflow do it) ───────────
  /** The kinds a draft can be on: the table, its draft fields, its json and NOT NULL columns, and who may publish it. */
  const DRAFT_KINDS = [
    { kind: 'page', table: page, fields: PAGE_DRAFT, json: new Set(['sections']), notNull: new Set(['title', 'sections']), permission: 'site:update' },
    { kind: 'post', table: post, fields: POST_DRAFT, json: new Set<string>(), notNull: new Set(['title', 'body']), permission: 'site:update' },
    { kind: 'portfolio', table: portfolioItem, fields: PORTFOLIO_DRAFT, json: new Set(['photos']), notNull: new Set(['title', 'body', 'photos']), permission: 'site:update' },
    { kind: 'settings', table: website, fields: SETTINGS_DRAFT, json: new Set(['nav', 'serviceAreas', 'palette', 'style']), notNull: new Set(['nav', 'serviceAreas', 'contactCtaLabel']), permission: 'site:settings' },
  ] as const

  /**
   * Every record with unpublished changes: pages, posts, portfolio work and the settings, each with its name, when it
   * was saved, and whether this person may publish it (site:update for content, site:settings for the settings).
   */
  async function unpublished(c: any) {
    const companyId = c.get('user').companyId
    const out: Array<{ kind: string; slug: string; title: string; savedAt: string | null; mayPublish: boolean }> = []
    for (const k of DRAFT_KINDS) {
      const t = k.table as any
      const rows = await db.select({ slug: k.kind === 'settings' ? t.id : t.slug, title: k.kind === 'settings' ? t.id : t.title, draft: t.draft })
        .from(t).where(and(eq(t.companyId, companyId), isNotNull(t.draft)))
      const may = await hasPermission(c, k.permission)
      for (const r of rows) {
        const d = draftOf(r)
        if (!d) continue
        out.push({
          kind: k.kind, slug: k.kind === 'settings' ? 'site' : r.slug,
          title: k.kind === 'settings' ? 'Website settings' : String(d.title || r.title),
          savedAt: typeof d.savedAt === 'string' ? d.savedAt : null, mayPublish: may,
        })
      }
    }
    return out
  }

  app.get('/drafts', may('site:read'), async (c) => listAll(c, await unpublished(c)))

  /**
   * Publish all: every unpublished change this person may publish goes live together, in one transaction — all of them
   * or none. `items` ([{ kind, slug }]) is the list the screen showed, so nothing saved after it was read is published
   * unseen; without it, everything there is. What they may not publish (a manager and the settings) stays a draft and
   * is named in `skipped`. Showing or hiding is not touched: a hidden page published here stays hidden.
   */
  app.post('/drafts/publish', may('site:update'), async (c) => {
    const body = await c.req.json().catch(() => ({})) as { items?: Array<{ kind?: unknown; slug?: unknown }> }
    const companyId = c.get('user').companyId
    const wanted = Array.isArray(body.items) ? new Set(body.items.map((i) => String(i?.kind) + '|' + String(i?.slug))) : null
    const all = await unpublished(c)
    const chosen = all.filter((i) => !wanted || wanted.has(i.kind + '|' + i.slug))
    const go = chosen.filter((i) => i.mayPublish)
    const skipped = chosen.filter((i) => !i.mayPublish).map(({ kind, slug, title }) => ({ kind, slug, title }))
    if (!go.length) return fail(c, 409, skipped.length ? 'You may not publish these changes.' : 'There are no unpublished changes.', 'nothing_to_publish')
    const published: Array<{ kind: string; slug: string; title: string }> = []
    await db.transaction(async (tx: any) => {
      for (const i of go) {
        const k = DRAFT_KINDS.find((x) => x.kind === i.kind)!
        const t = k.table as any
        const where = i.kind === 'settings'
          ? and(eq(t.companyId, companyId), isNotNull(t.draft))
          : and(eq(t.companyId, companyId), eq(t.slug, i.slug), isNotNull(t.draft))
        const done = await tx.update(t).set({ ...publishSet(t, k.fields, k.json, k.notNull), updatedAt: new Date() }).where(where).returning({ id: t.id })
        if (done.length) published.push({ kind: i.kind, slug: i.slug, title: i.title })
      }
    })
    return one(c, { published, skipped })
  })

  // ── Visits and enquiries, last 30 days against the 30 before ─────────────
  app.get('/analytics', may('site:read'), async (c) => {
    const companyId = c.get('user').companyId
    // Visits are counted per company day (data/pageViews.ts); the windows are counted back from the company's today.
    const tz = await companyTimeZone(db, companyId)
    const now = Date.now()
    const day = (d: Date) => storeDateString(d, tz)
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
