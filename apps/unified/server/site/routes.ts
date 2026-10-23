// The public website's pages (SPEC §3 "Public-marketing"). Moved from the premium site's server-static.ts: home,
// any page by slug, service areas, the portfolio, the dealer inventory, the Visualizer, the blog, the sitemap,
// robots.txt, llms.txt and the contact form's no-script post. Bookings (/book, /booking) arrive with the one
// booking engine (step 2d); the dispensary's live menu and the roofer's instant estimator with their add-ons.
import { Hono, type Context } from 'hono'
import { and, asc, desc, eq } from 'drizzle-orm'
import fs from 'node:fs'
import path from 'node:path'
import { company, page, post, portfolioItem } from '../db/schema/index.ts'
import type { VerticalSettings } from '../core/vertical.ts'
import { accentOnLight, DEFAULT_ACCENT, ensureDark, inkOn } from '../core/brandColour.ts'
import { countView } from '../data/pageViews.ts'
import { loadSiteContext, type SiteContext } from './context.ts'
import { renderSections, renderBody, homePlaceholder, markdownToHtml, siteOrigin, escHtml, escXml, type PageMeta } from './render.ts'
import { feedUnits, feedUrlOk, unitSpecs } from './inventoryFeed.ts'
import type { createEnquiryHandler } from './enquiryHandler.ts'
import { RESERVED_SLUGS } from './slugs.ts'
import { privacyHtml, termsHtml } from './legal.ts'
import { PUBLIC_PHOTO_PREFIX, type PhotoStore } from './admin.ts'
import type { Storefront } from '../crm/store/index.ts'
import { servesWhileClosed, unavailablePage } from './shop.ts'
import type { SiteFacts, PageFacts } from './facts.ts'
import { pageTitle, withBusinessServices } from './menu.ts'

const SITE_DIR = path.join(import.meta.dir, '..', '..', 'site')
const BASE_CSS = fs.readFileSync(path.join(SITE_DIR, 'public', 'styles', 'main.css'), 'utf8')
// The roofer's instant-estimate widget (site/public/scripts/estimator.ts, made browser JavaScript once at start), embedded
// on this site or any other.
const ESTIMATOR_JS = new Bun.Transpiler({ loader: 'ts', target: 'browser' }).transformSync(fs.readFileSync(path.join(SITE_DIR, 'public', 'scripts', 'estimator.ts'), 'utf8'))
// A store's own (CrmSettings.store): the shop pages' stylesheet, added to the site's, and the cart (sections/shop/*).
const STORE_CSS = fs.readFileSync(path.join(SITE_DIR, 'public', 'styles', 'store.css'), 'utf8')
const CART_JS = new Bun.Transpiler({ loader: 'ts', target: 'browser' }).transformSync(fs.readFileSync(path.join(SITE_DIR, 'public', 'scripts', 'cart.ts'), 'utf8'))
const DESIGN_CSS = new Map<string, string>()
for (const f of fs.readdirSync(path.join(SITE_DIR, 'designs'))) DESIGN_CSS.set(f.replace(/\.css$/, ''), fs.readFileSync(path.join(SITE_DIR, 'designs', f), 'utf8'))
// A cover design's own files (the bar's, templates/website-premium-bar build/): its self-hosted faces and their sheet, the
// speakeasy overlay's sheet (loaded on the first knock), and the scripts its sections name — the Tonight board's poller,
// the speakeasy door, the story's book. Served to any site; only a page that has the section asks for them.
// The base as a cover design's fallback layer. An !important inside a layer beats every unlayered !important, so the
// base's .mobile-nav__cta colour would win over the design's own; the base keeps its !important only on [hidden] rules,
// where it hides a card the base itself displays.
const BASE_CSS_UNDER_A_COVER = BASE_CSS.replace(/([^{}]+)\{([^{}]*)\}/g, (m, sel: string, body: string) => /\[hidden\]/.test(sel) ? m : sel + '{' + body.replace(/\s*!important/g, '') + '}')
const FONTS_DIR = path.join(SITE_DIR, 'public', 'fonts')
const FONT_FILES = new Set(fs.readdirSync(FONTS_DIR).filter((f) => f.endsWith('.woff2')))
const STYLES = new Map(['fonts.css', 'speakeasy.css'].map((f) => [f, fs.readFileSync(path.join(SITE_DIR, 'public', 'styles', f), 'utf8')]))
const SCRIPTS = new Map(['live', 'speakeasy', 'book'].map((f) => [f + '.js', new Bun.Transpiler({ loader: 'ts', target: 'browser' }).transformSync(fs.readFileSync(path.join(SITE_DIR, 'public', 'scripts', f + '.ts'), 'utf8'))]))


function areaSlug(name: string): string {
  return name.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80)
}

/** The places the owner serves, each with its /service-areas/<slug> page. */
export function serviceAreasOf(settings: any): Array<{ name: string; slug: string }> {
  const raw = Array.isArray(settings?.serviceAreas) ? settings.serviceAreas : []
  const out: Array<{ name: string; slug: string }> = []
  const seen = new Set<string>()
  for (const v of raw) {
    const name = String((v && typeof v === 'object' ? v.name : v) || '').trim().slice(0, 80)
    const slug = areaSlug(name)
    if (!name || !slug || seen.has(slug)) continue
    seen.add(slug)
    out.push({ name, slug })
  }
  return out.slice(0, 40)
}

const listOf = (names: string[]) => names.length <= 2 ? names.join(' and ') : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1]
const contactCta = (ctx: SiteContext) => ({ type: 'cta', variant: 'banner', data: { id: 'talk', heading: 'Talk to ' + ctx.settings.companyName, primaryCta: { label: ctx.settings.contactCtaLabel || 'Get in touch', href: '/contact' } } })
const projectCard = (p: any) => {
  const photos = Array.isArray(p.photos) ? p.photos : []
  return { slug: p.slug, title: p.title, location: p.location || '', summary: p.summary || '', image: p.coverImageUrl || photos[0] || '' }
}

/**
 * The stylesheet: the base, then the site's design, with the company's colours filled in. A cover design is a whole look
 * of its own (COVER_DESIGNS): the base goes beneath it as a CSS layer, so every rule of the design wins, in its own
 * order, and the base styles only what the design never does (the booking pages, a section its template lacked).
 */
export function siteStylesheet(ctx: SiteContext): string {
  const accent = ctx.colours.accent || DEFAULT_ACCENT
  const base = ctx.options.cover ? '@layer base {\n' + BASE_CSS_UNDER_A_COVER + '\n}' : BASE_CSS
  const css = base + (DESIGN_CSS.has(ctx.design) ? '\n' + DESIGN_CSS.get(ctx.design) : '') + (ctx.options.shop ? '\n' + STORE_CSS : '')
  return css
    .replaceAll('{{PRIMARY_COLOR}}', ctx.colours.primary)
    // The design's dark band, kept dark whatever the owner picked, as the Factory's generator filled it.
    .replaceAll('{{SECONDARY_COLOR}}', ensureDark(ctx.colours.secondary || '#1e3a5f'))
    .replaceAll('{{ACCENT_COLOR_ON_LIGHT}}', accentOnLight(accent))
    // Text on a fill of the owner's colour: dark ink or white, whichever reads (brandColour.ts inkOn).
    .replaceAll('{{INK_ON_PRIMARY}}', inkOn(ctx.colours.primary))
    .replaceAll('{{INK_ON_ACCENT}}', inkOn(accent, '#0f172a'))
    .replaceAll('{{ACCENT_COLOR}}', accent)
}

export function createSiteRoutes(deps: { db: any; vertical: VerticalSettings; enquiries: ReturnType<typeof createEnquiryHandler>; store: PhotoStore; shop?: Storefront | null; facts?: SiteFacts | null }) {
  const { db, vertical } = deps
  const app = new Hono()
  const shop = deps.shop ?? null
  // The live facts the vertical's own sections read (SiteSettings.facts: the bar's night), from its add-on.
  const facts = deps.facts ?? null

  // A store whose subscription has ended is closed to shoppers: its pages answer one plain page instead of a shop with a
  // checkout that fails (templates/website-store storeStatus.ts). The order-received page, the API, the admin and the
  // files stay (shop.ts servesWhileClosed).
  if (shop) app.use('*', async (c, next) => {
    if (c.req.method !== 'GET' || servesWhileClosed(c.req.path) || !(await shop.isClosed())) return next()
    const ctx = await ctxOf()
    return c.html(unavailablePage(ctx?.settings.companyName ?? null), 503, { 'Retry-After': '3600', 'Cache-Control': 'no-store' })
  })

  const ctxOf = async () => loadSiteContext(db, vertical)
  const loadPage = async (companyId: string, slug: string) =>
    (await db.select().from(page).where(and(eq(page.companyId, companyId), eq(page.slug, slug))).limit(1))[0] || null
  const publishedPortfolio = (companyId: string) =>
    db.select().from(portfolioItem).where(and(eq(portfolioItem.companyId, companyId), eq(portfolioItem.status, 'published')))
      .orderBy(asc(portfolioItem.sortOrder), desc(portfolioItem.publishedAt))
  async function firstSectionOfType(companyId: string, type: string, slugs: string[]) {
    for (const slug of slugs) {
      const p = await loadPage(companyId, slug)
      if (!p || !p.isPublished || !Array.isArray(p.sections)) continue
      const s = (p.sections as any[]).find((x) => x && x.type === type)
      if (s) return s
    }
    return null
  }
  /** Nav items the site adds when the owner's nav lacks them: the dealer's Inventory, the Visualizer, a store's Shop. */
  function toolNav(ctx: SiteContext, visualizer: boolean) {
    const items: Array<{ label: string; href: string }> = []
    if (feedUrlOk(ctx.settings.inventoryFeedUrl)) items.push({ label: 'Inventory', href: '/inventory' })
    if (visualizer) items.push({ label: 'Visualizer', href: '/visualize' })
    if (shop) items.push({ label: 'Shop', href: '/shop' })
    return items
  }
  const visionOrigin = () => { try { const u = new URL(String(vertical.visionUrl?.() || '')); return u.protocol === 'https:' ? u.origin : '' } catch { return '' } }
  /**
   * The Exterior Visualizer is a paid add-on, off by default (featureRegistry 'visualizer'): the public site offers its
   * page and nav item only while the business has it switched on — a configured Visualizer address is not enough
   * (2026-10-22: the add-on's only server gate was the admin page's own check).
   */
  const visualizerOn = async (companyId: string) => {
    if (!visionOrigin()) return false
    const [co] = await db.select({ f: company.enabledFeatures }).from(company).where(eq(company.id, companyId)).limit(1)
    return Array.isArray(co?.f) && (co!.f as string[]).includes('visualizer')
  }
  /**
   * Count a visit — unless it is the admin's live preview: a same-origin frame (the browser sets both headers; a page
   * can't). Every save reloads the preview, which counted the owner's own edits as traffic.
   */
  function count(c: Context, ctx: SiteContext, pathname: string) {
    if (c.req.header('sec-fetch-dest') === 'iframe' && c.req.header('sec-fetch-site') === 'same-origin') return
    countView(db, ctx.companyId, pathname)
  }
  /** This page's live facts, when the vertical's sections read them. */
  const factsOf = async (ctx: SiteContext) => (facts ? { page: await facts.load(ctx.companyId, ctx.settings), source: facts } : null)
  /** Render, count the visit, answer. A page the facts made passes the facts it was made from. */
  async function page200(c: Context, ctx: SiteContext, pathname: string, sections: any[], meta: PageMeta, pageFacts?: { page: PageFacts; source: SiteFacts; about?: unknown }) {
    count(c, ctx, pathname)
    const f = pageFacts ?? await factsOf(ctx)
    return c.html(await renderSections(ctx, sections, meta, { currentPath: pathname, origin: siteOrigin(c), extraNav: toolNav(ctx, await visualizerOn(ctx.companyId)), facts: f }))
  }

  // ── Assets ────────────────────────────────────────────────────────────────
  app.get('/styles/main.css', async (c) => {
    const ctx = await ctxOf()
    if (!ctx) return c.text('/* no site yet */', 200, { 'Content-Type': 'text/css' })
    // Long-lived: the page links it with the deploy and colours in the query (render.ts assetVersion).
    return c.body(siteStylesheet(ctx), 200, { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'public, max-age=31536000, immutable' })
  })

  // The website's own photos, by the address they were saved with. Only the public prefix: private CRM files share the
  // store, and /media must never be a way to reach them.
  app.get('/media/*', async (c) => {
    const key = decodeURIComponent(c.req.path.replace(/^\/media\//, ''))
    if (!key.startsWith(PUBLIC_PHOTO_PREFIX) || key.includes('..')) return c.notFound()
    const obj = await deps.store.getObject(key)
    if (!obj) return c.notFound()
    // AVIF too: a store's product photos are uploaded as they are (crm/store/catalog/products.ts, the template's
    // routes/media.ts served AVIF inline); the website's own uploads are re-encoded to JPEG or PNG.
    const safe = /^image\/(jpeg|png|webp|gif|avif)$/.test(obj.contentType)
    // An SVG (a logo moved from a premium site's /images) is shown as an image, as the template served it; it can carry
    // script, so it goes with a policy that runs none and loads nothing even when opened directly. In an <img> a
    // browser never runs an SVG's script anyway.
    const svg = obj.contentType === 'image/svg+xml'
    return c.body(obj.body as any, 200, {
      'Content-Type': safe || svg ? obj.contentType : 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      ...(svg ? { 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox" } : {}),
      ...(safe || svg ? {} : { 'Content-Disposition': 'attachment' }),
      'Cache-Control': 'public, max-age=31536000, immutable',
    })
  })

  app.get('/fonts/:file', (c) => {
    const file = c.req.param('file')
    if (!FONT_FILES.has(file)) return c.notFound()
    return c.body(fs.readFileSync(path.join(FONTS_DIR, file)), 200, { 'Content-Type': 'font/woff2', 'Cache-Control': 'public, max-age=31536000, immutable' })
  })
  app.get('/styles/:file', (c, next) => {
    const css = STYLES.get(c.req.param('file'))
    if (css === undefined) return next()
    return c.body(css, 200, { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'public, max-age=86400' })
  })
  app.get('/scripts/:file', (c, next) => {
    const js = SCRIPTS.get(c.req.param('file'))
    if (js === undefined) return next()
    return c.body(js, 200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=3600' })
  })

  // RFC 9116: every tenant points at the one coordinated disclosure page.
  app.get('/.well-known/security.txt', (c) => {
    const expires = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
    return c.text('Contact: mailto:security@twomiah.com\nExpires: ' + expires + '\nPreferred-Languages: en\nCanonical: https://twomiah.com/.well-known/security.txt\nPolicy: https://twomiah.com/security\n')
  })

  // ── Pages ─────────────────────────────────────────────────────────────────
  app.get('/', async (c) => {
    const ctx = await ctxOf()
    if (!ctx) return c.html(homePlaceholder(process.env.SITE_NAME || 'Your Site'))
    const home = await loadPage(ctx.companyId, 'home')
    if (!home || !home.isPublished) return c.html(homePlaceholder(ctx.settings.companyName))
    return page200(c, ctx, '/', Array.isArray(home.sections) ? home.sections : [], home)
  })

  app.get('/service-areas', async (c) => {
    const ctx = await ctxOf()
    const areas = serviceAreasOf(ctx?.settings)
    if (!ctx || !areas.length) return c.notFound()
    const name = ctx.settings.companyName
    const served = name + ' serves ' + listOf(areas.map((a) => a.name)) + '.'
    return page200(c, ctx, '/service-areas', [
      { type: 'hero', variant: 'centered-stats', data: { eyebrow: 'Service areas', title: 'Where we work', subtitle: served } },
      { type: 'areas', variant: 'list', data: { heading: 'Areas we serve', areas } },
      contactCta(ctx),
    ], { title: 'Service areas', metaDescription: served })
  })

  app.get('/service-areas/:area', async (c) => {
    const ctx = await ctxOf()
    const areas = serviceAreasOf(ctx?.settings)
    const area = areas.find((a) => a.slug === c.req.param('area'))
    if (!ctx || !area) return c.notFound()
    const name = ctx.settings.companyName
    const [found, contact] = await Promise.all([firstSectionOfType(ctx.companyId, 'services', ['services', 'home']), firstSectionOfType(ctx.companyId, 'contact', ['contact'])])
    // As the business has them now (site/menu.ts): never the trade stand-in in "Roofing in Altoona."
    const [services] = found ? withBusinessServices([found], ctx.services ?? [], ctx.trade ?? '') : []
    const serviceNames: string[] = Array.isArray(services?.data?.items)
      ? services.data.items.map((i: any) => String(i?.title || '').trim()).filter(Boolean).slice(0, 4) : []
    const lead = serviceNames.length ? listOf(serviceNames) + ' in ' + area.name + '.' : name + ' serves ' + area.name + '.'
    const others = areas.filter((a) => a.slug !== area.slug)
    const sections: any[] = [
      { type: 'hero', variant: 'centered-stats', data: { eyebrow: 'Service area', title: name + ' in ' + area.name, subtitle: lead, primaryCta: { label: ctx.settings.contactCtaLabel || 'Get in touch', href: '/contact' } } },
    ]
    if (services) sections.push({ ...services, data: { ...services.data, heading: 'What we do in ' + area.name } })
    if (others.length) sections.push({ type: 'areas', variant: 'list', data: { heading: 'Other areas we serve', areas: others } })
    sections.push(contact || contactCta(ctx))
    return page200(c, ctx, '/service-areas/' + area.slug, sections, { title: area.name, metaDescription: lead })
  })

  // The owner's finished work (the site's "projects"; table portfolio_item).
  app.get('/projects', async (c) => {
    const ctx = await ctxOf()
    if (!ctx) return c.notFound()
    const [composedPage, list] = await Promise.all([loadPage(ctx.companyId, 'projects'), publishedPortfolio(ctx.companyId)])
    const composed = composedPage && composedPage.isPublished && Array.isArray(composedPage.sections) ? (composedPage.sections as any[]) : null
    if (!list.length && !composed) return c.notFound()
    const name = ctx.settings.companyName
    let sections: any[]
    if (!list.length) sections = composed!
    else if (composed) {
      const grid = { type: 'projects', variant: 'grid', data: { heading: 'Recent projects', items: list.map(projectCard) } }
      sections = composed[0]?.type === 'hero' ? [composed[0], grid, ...composed.slice(1)] : [grid, ...composed]
    } else {
      sections = [
        { type: 'hero', variant: 'centered-stats', data: { eyebrow: 'Our work', title: 'Projects', subtitle: 'Recent work by ' + name + '.' } },
        { type: 'projects', variant: 'grid', data: { items: list.map(projectCard) } },
        contactCta(ctx),
      ]
    }
    return page200(c, ctx, '/projects', sections, {
      title: composedPage?.title || 'Projects', metaTitle: composedPage?.metaTitle || null, metaDescription: composedPage?.metaDescription || 'Recent work by ' + name + '.',
    })
  })

  app.get('/projects/:slug', async (c) => {
    const ctx = await ctxOf()
    if (!ctx) return c.notFound()
    const [p] = await db.select().from(portfolioItem).where(and(eq(portfolioItem.companyId, ctx.companyId), eq(portfolioItem.slug, c.req.param('slug')))).limit(1)
    if (!p || p.status !== 'published') return c.notFound()
    const [others, contact] = await Promise.all([publishedPortfolio(ctx.companyId), firstSectionOfType(ctx.companyId, 'contact', ['contact'])])
    const name = ctx.settings.companyName
    const alt = p.title + (p.location ? ', ' + p.location : '')
    const photos = (Array.isArray(p.photos) ? p.photos : []).filter((u: unknown) => typeof u === 'string' && u)
    const more = others.filter((x: any) => x.slug !== p.slug).slice(0, 3)
    const sections: any[] = [
      { type: 'hero', variant: 'centered-stats', data: { eyebrow: p.location || 'Project', title: p.title, subtitle: p.summary || '' } },
      { type: 'projects', variant: 'detail', data: { cover: p.coverImageUrl || '', alt, bodyHtml: markdownToHtml(p.body || ''), photos: photos.map((u: string) => ({ url: u, alt })) } },
    ]
    if (more.length) sections.push({ type: 'projects', variant: 'grid', data: { heading: 'More projects', items: more.map(projectCard) } })
    sections.push(contact || contactCta(ctx))
    return page200(c, ctx, '/projects/' + p.slug, sections, { title: alt, metaTitle: p.metaTitle || null, metaDescription: p.metaDescription || p.summary || '' })
  })

  // ── A store's shop (CrmSettings.store; sections/shop/*) ───────────────────
  // From templates/website-store server-static.ts, which fetched these from the store's API over HTTP; here they read
  // the store's own catalogue and order summary. The cart is the browser's (/scripts/cart.js).
  if (shop) {
    app.get('/shop', async (c) => {
      const ctx = await ctxOf()
      if (!ctx) return c.notFound()
      const products = await shop.catalogue(ctx.companyId)
      const name = ctx.settings.companyName
      return page200(c, ctx, '/shop', [{ type: 'shop', variant: 'grid', data: { products } }], { title: 'Shop', metaDescription: 'Browse products from ' + name + '.' })
    })
    app.get('/product/:slug', async (c) => {
      const ctx = await ctxOf()
      if (!ctx) return c.notFound()
      const p = await shop.product(ctx.companyId, c.req.param('slug'))
      if (!p) return c.notFound()
      const name = ctx.settings.companyName
      return page200(c, ctx, '/product/' + p.slug, [{ type: 'shop', variant: 'product', data: { product: p } }], {
        title: p.name, metaTitle: p.seoTitle || null, metaDescription: (p.seoDescription || p.tagline || p.name || '').slice(0, 300),
      })
    })
    app.get('/cart', async (c) => {
      const ctx = await ctxOf()
      if (!ctx) return c.notFound()
      return page200(c, ctx, '/cart', [{ type: 'shop', variant: 'cart', data: {} }], { title: 'Your Cart', metaDescription: 'Review the items in your cart.' })
    })
    // Stripe returns ?session_id=; Square and PayPal ?ref=<order id>. An order whose payment notice is late is finished here.
    app.get('/checkout/success', async (c) => {
      const ctx = await ctxOf()
      if (!ctx) return c.notFound()
      const sessionId = c.req.query('session_id') || '', ref = c.req.query('ref') || ''
      const order = sessionId || ref ? await shop.orderSummary(ctx.companyId, { sessionId: sessionId || null, ref: ref || null }).catch(() => null) : null
      return page200(c, ctx, '/checkout/success', [{ type: 'shop', variant: 'receipt', data: { order } }], { title: 'Order received', metaDescription: 'Thank you for your order.' })
    })
  }

  // ── Dealer inventory ─────────────────────────────────────────────────────
  app.get('/inventory', async (c, next) => {
    const ctx = await ctxOf()
    const all = ctx ? await feedUnits(ctx.settings.inventoryFeedUrl) : null
    if (!ctx || !all) return next()  // no feed (or it's down with nothing cached): the composed /inventory page, if any
    const q = { q: (c.req.query('q') || '').slice(0, 80), condition: c.req.query('condition') || '', category: c.req.query('category') || '', make: c.req.query('make') || '', sort: c.req.query('sort') || '' }
    const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))].sort()
    const facets = { conditions: uniq(all.map((u) => u.condition)), categories: uniq(all.map((u) => u.category)), makes: uniq(all.map((u) => u.make)) }
    const needle = q.q.toLowerCase()
    let units = all.filter((u) => (!q.condition || u.condition === q.condition) && (!q.category || u.category === q.category)
      && (!q.make || u.make === q.make) && (!needle || (u.title + ' ' + u.stock).toLowerCase().includes(needle)))
    if (q.sort === 'price-asc') units = [...units].sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity))
    else if (q.sort === 'price-desc') units = [...units].sort((a, b) => (b.price ?? -1) - (a.price ?? -1))
    const name = ctx.settings.companyName
    const composed = await loadPage(ctx.companyId, 'inventory')
    const composedHero = composed?.isPublished && Array.isArray(composed.sections) ? (composed.sections as any[]).find((s) => s?.type === 'hero') : null
    return page200(c, ctx, '/inventory', [
      composedHero || { type: 'hero', variant: 'centered-stats', data: { eyebrow: name, title: 'Inventory' } },
      { type: 'inventory', variant: 'live', data: { units, total: all.length, facets, query: q } },
      contactCta(ctx),
    ], { title: 'Inventory', metaDescription: name + ' — ' + all.length + ' unit' + (all.length === 1 ? '' : 's') + ' for sale.' })
  })

  app.get('/inventory/:unit', async (c) => {
    const ctx = await ctxOf()
    const all = ctx ? await feedUnits(ctx.settings.inventoryFeedUrl) : null
    if (!ctx || !all) return c.notFound()
    const u = all.find((x) => x.slug === c.req.param('unit'))
    if (!u) return c.redirect('/inventory', 302)  // sold or delisted: the lot, not a dead end
    const name = ctx.settings.companyName
    return page200(c, ctx, '/inventory/' + u.slug, [{ type: 'inventory', variant: 'unit', data: { unit: u, specs: unitSpecs(u) } }], {
      title: u.title + (u.price ? ' — $' + Number(u.price).toLocaleString('en-US') : ''),
      metaDescription: (u.description || u.title + ' at ' + name + '.').slice(0, 300),
    })
  })

  // ── Exterior Visualizer ──────────────────────────────────────────────────
  // Embeds the business's Visualizer; this page alone allows that one origin to be framed.
  app.get('/visualize', async (c, next) => {
    const origin = visionOrigin()
    const ctx = await ctxOf()
    if (!origin || !ctx || !(await visualizerOn(ctx.companyId))) return next()
    const name = ctx.settings.companyName
    c.header('Content-Security-Policy', [
      "default-src 'self'", "img-src 'self' data: https:", "font-src 'self' https://fonts.gstatic.com data:",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", "script-src 'self' 'unsafe-inline'", "connect-src 'self'",
      'frame-src ' + origin, "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'",
    ].join('; '))
    c.header('Permissions-Policy', 'camera=(self "' + origin + '"), microphone=(), geolocation=(), interest-cohort=()')
    return page200(c, ctx, '/visualize', [
      { type: 'hero', variant: 'centered-stats', data: { eyebrow: name, title: 'See it on your home', subtitle: 'Upload a photo of your house and try materials and colors before any work begins.' } },
      { type: 'tools', variant: 'visualizer', data: { src: origin + '/embed?tenant=' + encodeURIComponent(ctx.slug) } },
      contactCta(ctx),
    ], { title: 'Visualizer', metaDescription: 'Try materials and colors on a photo of your home with ' + name + '.' })
  })

  // ── The business's privacy policy and terms (site/legal.ts) ───────────────
  for (const [pathname, title, html] of [['/privacy', 'Privacy Policy', privacyHtml], ['/terms', 'Terms', termsHtml]] as const) {
    app.get(pathname, async (c) => {
      const ctx = await ctxOf()
      if (!ctx) return c.notFound()
      count(c, ctx, pathname)
      return c.html(await renderBody(ctx, html(ctx.settings as any), {
        siteOrigin: siteOrigin(c), homeHref: '/', contactHref: '/contact',
        seoTitle: pageTitle(ctx.settings, { title }),
        seoDescription: title + ' for ' + ctx.settings.companyName + ', including how we text customers.',
      }, pathname))
    })
  }

  // ── Blog ─────────────────────────────────────────────────────────────────
  app.get('/blog', async (c) => {
    const ctx = await ctxOf()
    if (!ctx) return c.notFound()
    const rows = await db.select().from(post).where(and(eq(post.companyId, ctx.companyId), eq(post.status, 'published'))).orderBy(desc(post.publishedAt))
    const listHtml = rows.length === 0
      ? '<p class="blog-empty">No posts yet. Check back soon.</p>'
      : '<div class="blog-list">' + rows.map((r: any) => {
          const date = r.publishedAt ? new Date(r.publishedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : ''
          return `<a class="blog-card" href="/blog/${encodeURIComponent(r.slug)}">
          ${r.coverImageUrl ? `<img class="blog-card__cover" src="${escHtml(r.coverImageUrl)}" alt="" loading="lazy">` : ''}
          <div class="blog-card__body">
            ${date ? `<div class="blog-card__date">${date}</div>` : ''}
            <h2 class="blog-card__title">${escHtml(r.title)}</h2>
            ${r.excerpt ? `<p class="blog-card__excerpt">${escHtml(r.excerpt)}</p>` : ''}
            <span class="blog-card__more">Read →</span>
          </div>
        </a>`
        }).join('') + '</div>'
    const body = '<section class="blog-section"><div class="container"><h1 class="blog-section__title">From the blog</h1>' + listHtml + '</div></section>'
    count(c, ctx, '/blog')
    return c.html(await renderBody(ctx, body, {
      siteOrigin: siteOrigin(c), homeHref: '/', contactHref: '/contact',
      seoTitle: pageTitle(ctx.settings, { title: 'Blog' }),
      seoDescription: ctx.settings.seoDescription || 'Recent posts from ' + ctx.settings.companyName + '.',
    }, '/blog'))
  })

  app.get('/blog/:slug', async (c) => {
    const ctx = await ctxOf()
    if (!ctx) return c.notFound()
    const [p] = await db.select().from(post).where(and(eq(post.companyId, ctx.companyId), eq(post.slug, c.req.param('slug')))).limit(1)
    if (!p || p.status !== 'published') return c.notFound()
    const date = p.publishedAt ? new Date(p.publishedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : ''
    const body = `<article class="blog-post">
    <div class="container container--narrow">
      <a class="blog-post__back" href="/blog">← All posts</a>
      ${p.coverImageUrl ? `<img class="blog-post__cover" src="${escHtml(p.coverImageUrl)}" alt="">` : ''}
      ${date ? `<div class="blog-post__date">${date}</div>` : ''}
      <h1 class="blog-post__title">${escHtml(p.title)}</h1>
      ${p.excerpt ? `<p class="blog-post__excerpt">${escHtml(p.excerpt)}</p>` : ''}
      <div class="blog-post__body">${markdownToHtml(p.body || '')}</div>
    </div>
  </article>`
    count(c, ctx, '/blog/' + p.slug)
    return c.html(await renderBody(ctx, body, {
      siteOrigin: siteOrigin(c), homeHref: '/', contactHref: '/contact',
      seoTitle: pageTitle(ctx.settings, { own: p.metaTitle, title: p.title }),
      seoDescription: p.metaDescription || p.excerpt || '',
    }, '/blog/' + p.slug))
  })

  // ── For search engines and AI assistants ─────────────────────────────────
  app.get('/sitemap.xml', async (c) => {
    const ctx = await ctxOf()
    const origin = siteOrigin(c)
    const urls: string[] = []
    if (ctx) {
      const iso = (d: any) => (d instanceof Date ? d : new Date(d)).toISOString()
      const pageRows = await db.select().from(page).where(and(eq(page.companyId, ctx.companyId), eq(page.isPublished, true))).orderBy(asc(page.navOrder), asc(page.title))
      for (const r of pageRows) urls.push(`  <url><loc>${escXml(origin + (r.slug === 'home' ? '/' : '/' + r.slug))}</loc><lastmod>${iso(r.updatedAt)}</lastmod></url>`)
      const portfolio = await publishedPortfolio(ctx.companyId)
      if (portfolio.length && !pageRows.some((r: any) => r.slug === 'projects')) urls.push(`  <url><loc>${escXml(origin + '/projects')}</loc></url>`)
      for (const r of portfolio) urls.push(`  <url><loc>${escXml(origin + '/projects/' + r.slug)}</loc><lastmod>${iso(r.updatedAt)}</lastmod></url>`)
      const units = await feedUnits(ctx.settings.inventoryFeedUrl)
      if (units && units.length) {
        if (!pageRows.some((r: any) => r.slug === 'inventory')) urls.push(`  <url><loc>${escXml(origin + '/inventory')}</loc></url>`)
        for (const u of units) urls.push(`  <url><loc>${escXml(origin + '/inventory/' + u.slug)}</loc></url>`)
      }
      // The pages the vertical's facts make: a bar's signature items and the eras of its story. Never fails the sitemap.
      if (facts) {
        try {
          const f = await facts.load(ctx.companyId, ctx.settings)
          for (const p of facts.sitemapPaths(f, new Set(pageRows.map((r: any) => r.slug)))) urls.push(`  <url><loc>${escXml(origin + p)}</loc></url>`)
        } catch { /* a sitemap never fails over the facts */ }
      }
      const areas = serviceAreasOf(ctx.settings)
      if (areas.length) {
        urls.push(`  <url><loc>${escXml(origin + '/service-areas')}</loc></url>`)
        for (const a of areas) urls.push(`  <url><loc>${escXml(origin + '/service-areas/' + a.slug)}</loc></url>`)
      }
      if (shop) {
        const products = await shop.catalogue(ctx.companyId)
        urls.push(`  <url><loc>${escXml(origin + '/shop')}</loc></url>`)
        for (const p of products) urls.push(`  <url><loc>${escXml(origin + '/product/' + encodeURIComponent(p.slug))}</loc><lastmod>${iso(p.updatedAt)}</lastmod></url>`)
      }
      const posts = await db.select().from(post).where(and(eq(post.companyId, ctx.companyId), eq(post.status, 'published'))).orderBy(desc(post.publishedAt))
      if (posts.length) {
        urls.push(`  <url><loc>${escXml(origin + '/blog')}</loc></url>`)
        for (const r of posts) urls.push(`  <url><loc>${escXml(origin + '/blog/' + r.slug)}</loc><lastmod>${iso(r.updatedAt)}</lastmod></url>`)
      }
    }
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`
    return c.body(xml, 200, { 'Content-Type': 'application/xml', 'Cache-Control': 'public, max-age=3600' })
  })

  // The instant-estimate widget: public, so a roofer can put it on any page (the CRM's Estimator settings give the
  // snippet). It asks /api/estimator on its own script's origin — gated there by instant_estimator and the company's
  // estimator switch.
  app.get('/estimator.js', (c) => c.body(ESTIMATOR_JS, 200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=3600' }))
  // The store's cart: only a store's site has one.
  app.get('/scripts/cart.js', async (c) => {
    const ctx = await ctxOf()
    if (!ctx?.options.shop) return c.notFound()
    return c.body(CART_JS, 200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=31536000, immutable' })
  })

  app.get('/robots.txt', (c) => {
    // The admin, the API, and customers' own booking pages stay out of search engines.
    const body = `User-agent: *\nAllow: /\nDisallow: /crm\nDisallow: /portal/\nDisallow: /vendor/\nDisallow: /d/\nDisallow: /api/\nDisallow: /booking/\nDisallow: /book/done\n\nSitemap: ${siteOrigin(c)}/sitemap.xml\n`
    return c.body(body, 200, { 'Content-Type': 'text/plain', 'Cache-Control': 'public, max-age=86400' })
  })

  // llms.txt (llmstxt.org): the business and its published pages, for AI assistants. States only what the owner's
  // settings and pages already say.
  app.get('/llms.txt', async (c) => {
    const ctx = await ctxOf()
    const origin = siteOrigin(c)
    const oneLine = (s: unknown) => String(s || '').replace(/\s+/g, ' ').trim()
    const linkText = (s: unknown) => oneLine(s).replace(/[\[\]]/g, '')
    const s = ctx?.settings
    const lines: string[] = ['# ' + (oneLine(s?.companyName) || 'Website'), '']
    const summary = oneLine(s?.seoDescription) || oneLine(s?.tagline)
    if (summary) lines.push('> ' + summary, '')
    const contactLines = [
      s?.phone ? 'Phone: ' + oneLine(s.phone) : '',
      s?.email ? 'Email: ' + oneLine(s.email) : '',
      // The area only: the street is often the owner's home. City and state from their own fields (the line carries
      // the ZIP with the state); a split of the line only where they are not given.
      (() => {
        if (s?.addressLocality && s?.addressRegion) return 'Area: ' + oneLine(s.addressLocality) + ', ' + oneLine(s.addressRegion)
        const p = oneLine(s?.address).split(',').map((x) => x.trim()).filter(Boolean); return p.length >= 2 ? 'Area: ' + p.slice(-2).join(', ') : ''
      })(),
    ].filter(Boolean)
    if (contactLines.length) lines.push(...contactLines.map((l) => '- ' + l), '')
    if (ctx) {
      const pageRows = await db.select().from(page).where(and(eq(page.companyId, ctx.companyId), eq(page.isPublished, true))).orderBy(asc(page.navOrder), asc(page.title))
      if (pageRows.length) {
        lines.push('## Pages', '')
        for (const r of pageRows) { const d = oneLine(r.metaDescription); lines.push(`- [${linkText(r.title)}](${origin}${r.slug === 'home' ? '/' : '/' + r.slug})${d ? ': ' + d : ''}`) }
        lines.push('')
      }
      const posts = await db.select().from(post).where(and(eq(post.companyId, ctx.companyId), eq(post.status, 'published'))).orderBy(desc(post.publishedAt))
      if (posts.length) {
        lines.push('## Blog', '')
        for (const r of posts) { const d = oneLine(r.excerpt); lines.push(`- [${linkText(r.title)}](${origin}/blog/${r.slug})${d ? ': ' + d : ''}`) }
        lines.push('')
      }
    }
    return c.body(lines.join('\n'), 200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' })
  })

  // Pages composed before the contact form posted to /api/leads posted here.
  app.post('/contact', (c) => deps.enquiries(c))

  // Any other single-segment path is a page of the owner's, if it exists and is published.
  app.get('/:slug', async (c) => {
    const slug = c.req.param('slug')
    if (RESERVED_SLUGS.has(slug)) return c.notFound()
    const ctx = await ctxOf()
    if (!ctx) return c.notFound()
    const p = await loadPage(ctx.companyId, slug)
    if (!p || !p.isPublished) return c.notFound()
    return page200(c, ctx, '/' + slug, Array.isArray(p.sections) ? p.sections : [], p)
  })

  // ── Nested pages ─────────────────────────────────────────────────────────
  // A page the vertical's facts make (templates/website-premium-bar server-static.ts): /story/<era>, an era of the
  // story timeline, and /<menu-section>/<item>, a signature item's own page (its photo, story, price and MenuItem
  // JSON-LD) — built from the menu itself, so there is nothing to keep in sync. Anything else falls through to 404.
  const NESTED_TAKEN = new Set([...RESERVED_SLUGS, 'projects', 'inventory', 'product', 'checkout', 'shop', 'cart'])
  if (facts) app.get('/:a/:b', async (c, next) => {
    const { a, b } = c.req.param()
    if (NESTED_TAKEN.has(a)) return next()
    const ctx = await ctxOf()
    if (!ctx) return next()
    const f = await factsOf(ctx)
    const made = f ? facts.nestedPage(f.page, a, b, ctx.settings.companyName) : null
    if (!f || !made) return next()
    return page200(c, ctx, made.path, made.sections, made.meta, { ...f, about: made.about })
  })

  return app
}
