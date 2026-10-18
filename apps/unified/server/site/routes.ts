// The public website's pages (SPEC §3 "Public-marketing"). Moved from the premium site's server-static.ts: home,
// any page by slug, service areas, the portfolio, the dealer inventory, the Visualizer, the blog, the sitemap,
// robots.txt, llms.txt and the contact form's no-script post. Bookings (/book, /booking) arrive with the one
// booking engine (step 2d); the dispensary's live menu and the roofer's instant estimator with their add-ons.
import { Hono, type Context } from 'hono'
import { and, asc, desc, eq } from 'drizzle-orm'
import fs from 'node:fs'
import path from 'node:path'
import { page, post, portfolioItem } from '../db/schema/index.ts'
import type { VerticalSettings } from '../core/vertical.ts'
import { accentOnLight, DEFAULT_ACCENT } from '../core/brandColour.ts'
import { countView } from '../data/pageViews.ts'
import { loadSiteContext, type SiteContext } from './context.ts'
import { renderSections, renderBody, homePlaceholder, markdownToHtml, siteOrigin, escHtml, escXml, type PageMeta } from './render.ts'
import { feedUnits, feedUrlOk, unitSpecs } from './inventoryFeed.ts'
import type { createEnquiryHandler } from './enquiryHandler.ts'

const SITE_DIR = path.join(import.meta.dir, '..', '..', 'site')
const BASE_CSS = fs.readFileSync(path.join(SITE_DIR, 'public', 'styles', 'main.css'), 'utf8')
const DESIGN_CSS = new Map<string, string>()
for (const f of fs.readdirSync(path.join(SITE_DIR, 'designs'))) DESIGN_CSS.set(f.replace(/\.css$/, ''), fs.readFileSync(path.join(SITE_DIR, 'designs', f), 'utf8'))

/** Paths a page may never take: the sitemap and friends, and every path the app itself serves. */
const RESERVED = new Set(['api', 'admin', 'crm', 'uploads', 'media', 'images', 'styles', 'scripts', 'health', 'sitemap.xml', 'robots.txt', 'llms.txt', 'blog', 'book', 'booking', 'customize', 'login', 'auth'])

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

/** The stylesheet: the base, then the site's design, with the company's colours filled in. */
export function siteStylesheet(ctx: SiteContext): string {
  const accent = ctx.colours.accent || DEFAULT_ACCENT
  const css = BASE_CSS + (DESIGN_CSS.has(ctx.design) ? '\n' + DESIGN_CSS.get(ctx.design) : '')
  return css
    .replaceAll('{{PRIMARY_COLOR}}', ctx.colours.primary)
    .replaceAll('{{ACCENT_COLOR_ON_LIGHT}}', accentOnLight(accent))
    .replaceAll('{{ACCENT_COLOR}}', accent)
}

export function createSiteRoutes(deps: { db: any; vertical: VerticalSettings; enquiries: ReturnType<typeof createEnquiryHandler> }) {
  const { db, vertical } = deps
  const app = new Hono()

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
  /** Nav items the site adds when the owner's nav lacks them: the dealer's Inventory, the Visualizer. */
  function toolNav(ctx: SiteContext) {
    const items: Array<{ label: string; href: string }> = []
    if (feedUrlOk(ctx.settings.inventoryFeedUrl)) items.push({ label: 'Inventory', href: '/inventory' })
    if (visionOrigin()) items.push({ label: 'Visualizer', href: '/visualize' })
    return items
  }
  const visionOrigin = () => { try { const u = new URL(String(vertical.visionUrl?.() || '')); return u.protocol === 'https:' ? u.origin : '' } catch { return '' } }
  /** Render, count the visit, answer. */
  async function page200(c: Context, ctx: SiteContext, pathname: string, sections: any[], meta: PageMeta) {
    countView(db, ctx.companyId, pathname)
    return c.html(await renderSections(ctx, sections, meta, { currentPath: pathname, origin: siteOrigin(c), extraNav: toolNav(ctx) }))
  }

  // ── Assets ────────────────────────────────────────────────────────────────
  app.get('/styles/main.css', async (c) => {
    const ctx = await ctxOf()
    if (!ctx) return c.text('/* no site yet */', 200, { 'Content-Type': 'text/css' })
    // Long-lived: the page links it with the deploy and colours in the query (render.ts assetVersion).
    return c.body(siteStylesheet(ctx), 200, { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'public, max-age=31536000, immutable' })
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
    ], { title: 'Service areas', metaTitle: 'Service areas | ' + name, metaDescription: served })
  })

  app.get('/service-areas/:area', async (c) => {
    const ctx = await ctxOf()
    const areas = serviceAreasOf(ctx?.settings)
    const area = areas.find((a) => a.slug === c.req.param('area'))
    if (!ctx || !area) return c.notFound()
    const name = ctx.settings.companyName
    const [services, contact] = await Promise.all([firstSectionOfType(ctx.companyId, 'services', ['services', 'home']), firstSectionOfType(ctx.companyId, 'contact', ['contact'])])
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
    return page200(c, ctx, '/service-areas/' + area.slug, sections, { title: area.name, metaTitle: name + ' in ' + area.name, metaDescription: lead })
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
      title: composedPage?.title || 'Projects', metaTitle: composedPage?.metaTitle || 'Projects | ' + name, metaDescription: composedPage?.metaDescription || 'Recent work by ' + name + '.',
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
    return page200(c, ctx, '/projects/' + p.slug, sections, { title: p.title, metaTitle: p.metaTitle || alt + ' | ' + name, metaDescription: p.metaDescription || p.summary || '' })
  })

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
    ], { title: 'Inventory', metaTitle: 'Inventory | ' + name, metaDescription: name + ' — ' + all.length + ' unit' + (all.length === 1 ? '' : 's') + ' for sale.' })
  })

  app.get('/inventory/:unit', async (c) => {
    const ctx = await ctxOf()
    const all = ctx ? await feedUnits(ctx.settings.inventoryFeedUrl) : null
    if (!ctx || !all) return c.notFound()
    const u = all.find((x) => x.slug === c.req.param('unit'))
    if (!u) return c.redirect('/inventory', 302)  // sold or delisted: the lot, not a dead end
    const name = ctx.settings.companyName
    return page200(c, ctx, '/inventory/' + u.slug, [{ type: 'inventory', variant: 'unit', data: { unit: u, specs: unitSpecs(u) } }], {
      title: u.title,
      metaTitle: u.title + (u.price ? ' — $' + Number(u.price).toLocaleString('en-US') : '') + ' | ' + name,
      metaDescription: (u.description || u.title + ' at ' + name + '.').slice(0, 300),
    })
  })

  // ── Exterior Visualizer ──────────────────────────────────────────────────
  // Embeds the business's Visualizer; this page alone allows that one origin to be framed.
  app.get('/visualize', async (c, next) => {
    const origin = visionOrigin()
    const ctx = await ctxOf()
    if (!origin || !ctx) return next()
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
    ], { title: 'Visualizer', metaTitle: 'Visualizer | ' + name, metaDescription: 'Try materials and colors on a photo of your home with ' + name + '.' })
  })

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
    countView(db, ctx.companyId, '/blog')
    return c.html(await renderBody(ctx, body, {
      siteOrigin: siteOrigin(c), homeHref: '/', contactHref: '/contact',
      seoTitle: 'Blog · ' + ctx.settings.companyName,
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
    countView(db, ctx.companyId, '/blog/' + p.slug)
    return c.html(await renderBody(ctx, body, {
      siteOrigin: siteOrigin(c), homeHref: '/', contactHref: '/contact',
      seoTitle: p.metaTitle || p.title + ' — ' + ctx.settings.companyName,
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
      const areas = serviceAreasOf(ctx.settings)
      if (areas.length) {
        urls.push(`  <url><loc>${escXml(origin + '/service-areas')}</loc></url>`)
        for (const a of areas) urls.push(`  <url><loc>${escXml(origin + '/service-areas/' + a.slug)}</loc></url>`)
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

  app.get('/robots.txt', (c) => {
    const body = `User-agent: *\nAllow: /\nDisallow: /admin/\nDisallow: /api/\n\nSitemap: ${siteOrigin(c)}/sitemap.xml\n`
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
      // The area only: the street is often the owner's home.
      (() => { const p = oneLine(s?.address).split(',').map((x) => x.trim()).filter(Boolean); return p.length >= 2 ? 'Area: ' + p.slice(-2).join(', ') : '' })(),
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
    if (RESERVED.has(slug)) return c.notFound()
    const ctx = await ctxOf()
    if (!ctx) return c.notFound()
    const p = await loadPage(ctx.companyId, slug)
    if (!p || !p.isPublished) return c.notFound()
    return page200(c, ctx, '/' + slug, Array.isArray(p.sections) ? p.sections : [], p)
  })

  return app
}
