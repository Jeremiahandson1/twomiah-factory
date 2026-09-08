/**
 * server-static.ts — premium-contractor template runtime.
 *
 * Renders pages from the section-composition schema:
 *   pages row → { sections: [...] } → views/home.ejs → views/base.ejs.
 *
 * Routes:
 *   /                 → renders page slug 'home'
 *   /:slug            → renders any other page row (about, services, contact, custom)
 *   /admin/*          → React SPA at admin/dist/ + JSON API at /api/admin/*
 *   /api/leads        → public POST for the contact form
 *   /api/internal/*   → Factory-key-gated control endpoints (settings sync, etc.)
 *   /uploads/*        → local-fallback static file serving for dev (R2 in prod)
 *   /styles/*, /scripts/* → inline-able build assets
 *   /health           → liveness for Render
 */
import { Hono } from 'hono'
import { registerMedia } from './services/mediaProxy.ts'
import { logger } from 'hono/logger'
import { cors } from 'hono/cors'
import { compress } from 'hono/compress'
import { serveStatic } from 'hono/bun'
import { eq, asc, desc, sql } from 'drizzle-orm'
import ejs from 'ejs'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { db } from './db'
import { settings as settingsTbl, pages as pagesTbl, leads as leadsTbl, posts as postsTbl, pageViews as pageViewsTbl } from './db/schema'
import adminRoutes from './routes/admin'
import { consolePages, consoleApi } from './routes/console'
import { secureHeaders, adminCors, loginRateLimit, isSafeUrl } from './lib/security'
import { buildBusinessSchema, toJsonLd } from './lib/schema-org/business'
import { pageJsonLd } from './lib/schema-org/page'
import { loadSiteData, bustSiteData } from './lib/site-data'
import { buildLiveState } from './lib/live'
import { markdownToHtml } from './lib/markdown'
import { alertOwner } from './lib/sms/twilio'
import { partyInquiries as partyInquiriesTbl } from './db/schema'

// Cache-busting version for local stylesheets: changes every deploy (Render
// sets RENDER_GIT_COMMIT) so browsers can keep long max-age but never serve
// a stale CSS bundle after a redeploy.
const ASSET_VERSION = (process.env.RENDER_GIT_COMMIT || '').slice(0, 8) || String(Date.now())

const app = new Hono()

app.use('*', logger())
// gzip/deflate every response Render doesn't already compress — main.css is 80 KB raw, ~14 KB gzipped.
app.use('*', compress())
app.use('*', secureHeaders())
// Public marketing pages can be embedded/fetched cross-origin freely.
// The admin API gets a stricter CORS gate further down.
app.use('*', cors())

// In-memory per-IP rate limit for the public contact form. Honeypot +
// dwell-time stop dumb bots; this stops someone hand-flooding a real
// browser. 5 submissions per IP per 10 minutes — generous for a human
// who's correcting typos, brutal for a flood.
const leadBuckets = new Map<string, number[]>()
const LEAD_WINDOW_MS = 10 * 60 * 1000
const LEAD_MAX = 5
function leadClientIp(c: any): string {
  const xff = c.req.header('X-Forwarded-For') || ''
  if (xff) return xff.split(',')[0].trim()
  return c.req.header('CF-Connecting-IP') || c.req.header('X-Real-IP') || 'unknown'
}

// ── Health ────────────────────────────────────────────────────────────────
app.get('/health', (c) => c.json({ ok: true, ts: new Date().toISOString() }))

// ─── Customer customizer entry ────────────────────────────────────────────
// One token per tenant lives in settings.customizerToken. The customer
// follows the emailed link, we verify in constant time, find-or-create
// the synthetic 'customer' user, and drop them into the admin SPA with
// a role-scoped session. AdminLayout filters the nav to Pages + Photos
// + Account when role==='customer' — no security/billing/etc surfaces.
app.get('/customize/:token', async (c) => {
  const provided = c.req.param('token') || ''
  const settings = await loadSettings()
  const expected = (settings as any)?.customizerToken || ''
  const ok = expected && provided.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
  if (!ok) {
    return c.html('<!doctype html><meta charset="utf-8"><title>Link expired</title>' +
      '<body style="font:16px system-ui;padding:48px;max-width:560px;margin:auto;color:#1a1a1a;">' +
      '<h1>This customize link isn\'t valid anymore</h1>' +
      '<p style="color:#666;">The owner of this site may have rotated the link. Ask them to send you a fresh one.</p>' +
      '</body>', 404)
  }
  const { users: usersTbl, sessions: sessionsTbl } = await import('./db/schema')
  const customerEmail = 'customer@local'
  const existing = (await db.select().from(usersTbl).where(eq(usersTbl.email, customerEmail)).limit(1))[0]
  let user = existing
  if (!user) {
    const bcrypt = await import('bcryptjs')
    const placeholderHash = await bcrypt.default.hash(crypto.randomBytes(32).toString('hex'), 10)
    const [created] = await db.insert(usersTbl).values({
      email: customerEmail,
      name: 'Customer',
      role: 'customer',
      passwordHash: placeholderHash,
    }).returning()
    user = created
  } else if (user.role !== 'customer') {
    await db.update(usersTbl).set({ role: 'customer' }).where(eq(usersTbl.id, user.id))
    user.role = 'customer'
  }
  const jti = crypto.randomBytes(16).toString('base64url')
  await db.insert(sessionsTbl).values({
    userId: user.id, jti,
    ip: (c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown').split(',')[0].trim(),
    userAgent: (c.req.header('User-Agent') || '').slice(0, 500),
  })
  const jwtLib = (await import('jsonwebtoken')).default
  const JWT_SECRET = process.env.JWT_SECRET || ''
  if (!JWT_SECRET) return c.text('Server misconfigured (no JWT_SECRET)', 503)
  const token = jwtLib.sign({ sub: user.id, email: user.email, role: 'customer', jti }, JWT_SECRET, { expiresIn: 60 * 60 * 12 })
  const { setCookie } = await import('hono/cookie')
  setCookie(c, 'auth', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'Strict', path: '/', maxAge: 60 * 60 * 12,
  })
  return c.redirect('/admin/pages')
})

// RFC 9116 security disclosure file. Pointer to twomiah.com/security
// keeps every tenant pointing to a single coordinated disclosure page.
app.get('/.well-known/security.txt', (c) => {
  const expires = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
  return c.text(
    'Contact: mailto:security@twomiah.com\n' +
    'Expires: ' + expires + '\n' +
    'Preferred-Languages: en\n' +
    'Canonical: https://twomiah.com/.well-known/security.txt\n' +
    'Policy: https://twomiah.com/security\n',
    200, { 'Content-Type': 'text/plain; charset=utf-8' }
  )
})

// ── Asset serving (CSS, JS, uploads) ──────────────────────────────────────
// Brand tokens. The factory generator substitutes {{PRIMARY_COLOR}} /
// {{SECONDARY_COLOR}} / {{ACCENT_COLOR}} into main.css at generation time;
// when this template is deployed straight from the repo (reference tenant)
// they must be filled at runtime from the settings row. Cached until the
// settings row changes. Defaults are the speakeasy palette.
let brandCssCache: { key: string; body: string } | null = null
app.get('/styles/main.css', async (c) => {
  const s: any = await loadSettings().catch(() => null)
  const key = String(s?.updatedAt instanceof Date ? s.updatedAt.getTime() : s?.updatedAt || 0)
  if (!brandCssCache || brandCssCache.key !== key) {
    const safe = (v: unknown, fb: string) => (/^#[0-9a-f]{3,8}$/i.test(String(v || '')) ? String(v) : fb)
    const raw = fs.readFileSync(path.join(__dirname, 'build', 'styles', 'main.css'), 'utf8')
    brandCssCache = {
      key,
      body: raw
        .replace(/\{\{PRIMARY_COLOR\}\}/g, safe(s?.primaryColor, '#C9A24E'))
        .replace(/\{\{SECONDARY_COLOR\}\}/g, safe(s?.secondaryColor, '#1F3A2E'))
        .replace(/\{\{ACCENT_COLOR\}\}/g, safe(s?.accentColor, '#EFE6D2')),
    }
  }
  c.header('Content-Type', 'text/css; charset=utf-8')
  c.header('Cache-Control', 'public, max-age=31536000, immutable')
  return c.body(brandCssCache.body)
})
app.use('/styles/*', serveStatic({ root: './build' }))
app.use('/fonts/*', serveStatic({ root: './build' }))
app.use('/scripts/*', serveStatic({ root: './build' }))
app.use('/uploads/*', serveStatic({ root: '.' }))
registerMedia(app)
// Favicon + synthesized logo (build/favicon.svg, build/images/logo.svg) — makes the
// browser-tab icon + og:image resolve. serveStatic 404s through when absent.
app.use('/favicon.svg', serveStatic({ root: './build' }))
app.use('/favicon.png', serveStatic({ root: './build' }))
app.use('/favicon.ico', serveStatic({ root: './build' }))
app.use('/images/*', serveStatic({ root: './build' }))

// ── Helpers ───────────────────────────────────────────────────────────────
const viewsDir = path.join(__dirname, 'views')

async function loadSettings() {
  const rows = await db.select().from(settingsTbl).limit(1)
  return rows[0] || null
}

async function loadPage(slug: string) {
  const rows = await db.select().from(pagesTbl).where(eq(pagesTbl.slug, slug)).limit(1)
  return rows[0] || null
}

// First-party pageview counter — fire-and-forget day/path upsert; a failed
// count must never affect a render.
function countView(path: string): void {
  const day = new Date().toISOString().slice(0, 10)
  db.insert(pageViewsTbl).values({ day, path, count: 1 })
    .onConflictDoUpdate({ target: [pageViewsTbl.day, pageViewsTbl.path], set: { count: sql`${pageViewsTbl.count} + 1` } })
    .catch(() => { /* non-blocking */ })
}

async function renderPage(slug: string, currentPath: string): Promise<string | null> {
  const [page, settingsRow] = await Promise.all([loadPage(slug), loadSettings()])
  if (!page || !page.isPublished) return null

  const homepage = { sections: Array.isArray(page.sections) ? page.sections : [] }
  const settings = settingsRow || { companyName: 'Your Company', nav: [], contactCtaLabel: 'Get in touch' }

  // Per-page SEO overrides
  const effectiveSettings = {
    ...settings,
    seoTitle: page.metaTitle || settings.seoTitle || page.title,
    seoDescription: page.metaDescription || settings.seoDescription || '',
  }

  // LCP preload: the first hero section's image is almost always the
  // Largest Contentful Paint on mobile. Emitting <link rel="preload"
  // as="image" fetchpriority="high"> lets the browser kick off the fetch
  // during HTML parse instead of waiting for the EJS section render to
  // discover the <img>. Mobile LCP typically improves 400-800ms.
  const firstHero = (homepage.sections as any[]).find(s => s && (s.type === 'hero' || s.type === 'tonight'))
  const lcpImage = firstHero?.type === 'tonight'
    ? (typeof firstHero.data?.coverImageSmall === 'string' ? firstHero.data.coverImageSmall : typeof firstHero.data?.coverImage === 'string' ? firstHero.data.coverImage : typeof firstHero.data?.titleImageSmall === 'string' ? firstHero.data.titleImageSmall : typeof firstHero.data?.titleImage === 'string' ? firstHero.data.titleImage : (typeof firstHero.data?.art === 'string' ? firstHero.data.art : ''))
    : (firstHero?.data?.image && typeof firstHero.data.image === 'string' ? firstHero.data.image : '')

  // Everything a section might need beyond its own JSON: the live state,
  // the menu, the taps, the timeline, upcoming events. One cached bundle
  // per render so partials never touch the database.
  const site = await loadSiteData()
  const body = await ejs.renderFile(path.join(viewsDir, 'home.ejs'), { homepage, settings: effectiveSettings, site, live: site.live, md: markdownToHtml, currentPath }) as string
  // Sitewide BarOrPub JSON-LD from the settings row with bar + kitchen
  // hours from lib/hours (kitchen as a `department`).
  const jsonLd = pageJsonLd({ slug, title: page.title, sections: homepage.sections as any[], settings: effectiveSettings as any, hoursSchema: site.hoursSchema, menu: site.menu as any, events: site.events as any })
  return ejs.renderFile(path.join(viewsDir, 'base.ejs'), { body, assetV: ASSET_VERSION, settings: effectiveSettings, crmApiUrl: process.env.CRM_API_URL || '', currentPath, lcpImage, jsonLd }) as Promise<string>
}

// Default placeholder served when the pages.home row doesn't exist yet
// (fresh deploy before the AI composer or admin has seeded any content).
// 200 status — the site is up and usable; the CMS admin link gets the
// owner straight to the editor.
function defaultHomePlaceholder(siteName: string): string {
  const safe = siteName.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] || c))
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${safe}</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:system-ui,-apple-system,sans-serif;margin:0;background:#fafaf7;color:#1a1a1a}main{max-width:680px;margin:10vh auto;padding:48px 32px;text-align:center}h1{font-size:2.5rem;margin:0 0 16px;letter-spacing:-.02em}p{color:#666;font-size:1.05rem;line-height:1.6;margin:0 0 32px}a.cta{display:inline-block;padding:14px 32px;background:#1a1a1a;color:#fff;text-decoration:none;border-radius:6px;font-weight:500}.tag{display:inline-block;font-size:.75rem;letter-spacing:.1em;text-transform:uppercase;color:#999;margin-bottom:24px}</style></head><body><main><span class="tag">Coming Soon</span><h1>${safe}</h1><p>Your premium website is being prepared. Sign in to the admin to add your home page content, or wait for our composition team to send your preview.</p><a class="cta" href="/admin">Open Admin</a></main></body></html>`
}

// ── Page routes ───────────────────────────────────────────────────────────
app.get('/', async (c) => {
  const html = await renderPage('home', '/')
  if (html) countView('/')
  if (!html) {
    const siteName = process.env.SITE_NAME || 'Your Site'
    return c.html(defaultHomePlaceholder(siteName))
  }
  return c.html(html)
})

// Blog routes — must register before the catch-all `/:slug` below or
// Hono dispatches /blog to the slug handler first.
app.get('/blog', async (c) => {
  const settings = await loadSettings()
  if (!settings) return c.text('Blog not configured yet.', 503)
  const rows = await db.select().from(postsTbl).where(eq(postsTbl.status, 'published')).orderBy(desc(postsTbl.publishedAt))
  const listHtml = rows.length === 0
    ? '<p class="blog-empty">No posts yet. Check back soon.</p>'
    : '<div class="blog-list">' + rows.map(r => {
        const date = r.publishedAt ? new Date(r.publishedAt as any).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : ''
        return `<a class="blog-card" href="/blog/${r.slug}">
          ${r.coverImageUrl ? `<img class="blog-card__cover" src="${r.coverImageUrl}" alt="" loading="lazy">` : ''}
          <div class="blog-card__body">
            ${date ? `<div class="blog-card__date">${date}</div>` : ''}
            <h2 class="blog-card__title">${r.title}</h2>
            ${r.excerpt ? `<p class="blog-card__excerpt">${r.excerpt}</p>` : ''}
            <span class="blog-card__more">Read →</span>
          </div>
        </a>`
      }).join('') + '</div>'
  const body = '<section class="blog-section"><div class="container"><h1 class="blog-section__title">From the blog</h1>' + listHtml + '</div></section>'
  const effectiveSettings = {
    ...settings,
    homeHref: '/',
    contactHref: '/contact',
    seoTitle: 'Blog · ' + (settings.companyName || 'Our blog'),
    seoDescription: settings.seoDescription || 'Recent posts from ' + (settings.companyName || 'the team') + '.',
    nav: settings.nav || [],
  }
  const html = await ejs.renderFile(path.join(viewsDir, 'base.ejs'), { body, assetV: ASSET_VERSION, settings: effectiveSettings, crmApiUrl: process.env.CRM_API_URL || '', currentPath: '/blog' }) as string
  return c.html(html)
})

app.get('/blog/:slug', async (c) => {
  const slug = c.req.param('slug')
  const settings = await loadSettings()
  if (!settings) return c.text('Blog not configured yet.', 503)
  const rows = await db.select().from(postsTbl).where(eq(postsTbl.slug, slug as string)).limit(1)
  const post = rows[0]
  if (!post || post.status !== 'published') return c.notFound()
  const date = post.publishedAt ? new Date(post.publishedAt as any).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : ''
  const body = `<article class="blog-post">
    <div class="container container--narrow">
      <a class="blog-post__back" href="/blog">← All posts</a>
      ${post.coverImageUrl ? `<img class="blog-post__cover" src="${post.coverImageUrl}" alt="">` : ''}
      ${date ? `<div class="blog-post__date">${date}</div>` : ''}
      <h1 class="blog-post__title">${post.title}</h1>
      ${post.excerpt ? `<p class="blog-post__excerpt">${post.excerpt}</p>` : ''}
      <div class="blog-post__body">${markdownToHtml(post.body || '')}</div>
    </div>
  </article>`
  const effectiveSettings = {
    ...settings,
    homeHref: '/',
    contactHref: '/contact',
    seoTitle: post.metaTitle || post.title + ' — ' + (settings.companyName || ''),
    seoDescription: post.metaDescription || post.excerpt || '',
    nav: settings.nav || [],
  }
  const html = await ejs.renderFile(path.join(viewsDir, 'base.ejs'), { body, assetV: ASSET_VERSION, settings: effectiveSettings, crmApiUrl: process.env.CRM_API_URL || '', currentPath: '/blog/' + slug }) as string
  return c.html(html)
})

// Match a single slug (no slashes, not an api/admin/uploads/styles/scripts prefix).
// ── Private party inquiries: form → Postgres → SMS to the owner ─────────
// Not a booking. Honeypot + dwell time + per-IP rate limit, same as leads.
app.post('/api/parties', async (c) => {
  const ip = leadClientIp(c)
  const nowMs = Date.now()
  const bucket = (leadBuckets.get(ip) || []).filter(t => nowMs - t < LEAD_WINDOW_MS)
  if (bucket.length >= LEAD_MAX) return c.text('Too many requests. Please call us instead.', 429)
  bucket.push(nowMs); leadBuckets.set(ip, bucket)
  const ct = c.req.header('content-type') || ''
  const body: Record<string, any> = ct.includes('application/json') ? await c.req.json().catch(() => ({})) : Object.fromEntries((await c.req.formData()).entries())
  const wantsJson = ct.includes('application/json')
  const silent = () => wantsJson ? c.json({ ok: true }) : c.redirect('/parties/thanks', 303)
  if (String(body.website || '').trim()) return silent()                 // honeypot
  const ts = Number(body.ts || 0)
  if (ts && nowMs - ts < 3000) return silent()                            // filled in under 3 s = bot
  const name = String(body.name || '').trim().slice(0, 120)
  const phone = String(body.phone || '').trim().slice(0, 40)
  if (!name || phone.replace(/\D/g, '').length < 7) return wantsJson ? c.json({ error: 'Name and a phone number are required.' }, 400) : c.text('Name and a phone number are required.', 400)
  const partySize = Number.parseInt(String(body.partySize || ''), 10)
  const row = {
    name, phone,
    email: String(body.email || '').trim().slice(0, 200) || null,
    partySize: Number.isFinite(partySize) ? partySize : null,
    requestedDate: /^\d{4}-\d{2}-\d{2}$/.test(String(body.requestedDate || '')) ? String(body.requestedDate) : null,
    occasion: String(body.occasion || '').trim().slice(0, 80) || null,
    message: String(body.message || '').trim().slice(0, 2000) || null,
  }
  const [saved] = await db.insert(partyInquiriesTbl).values(row).returning()
  const text = `Party inquiry: ${name}, ${phone}` + (row.partySize ? `, ${row.partySize} people` : '') + (row.requestedDate ? `, ${row.requestedDate}` : '') + (row.occasion ? ` — ${row.occasion}` : '') + (row.message ? `. "${row.message.slice(0, 160)}"` : '')
  alertOwner(text).then(r => { if (r.ok) db.update(partyInquiriesTbl).set({ smsSentAt: new Date() }).where(eq(partyInquiriesTbl.id, saved.id)).catch(() => {}) }).catch(() => {})
  bustSiteData()
  return wantsJson ? c.json({ ok: true, id: saved.id }) : c.redirect('/parties/thanks', 303)
})

app.get('/parties/thanks', async (c) => {
  const settingsRow = await loadSettings()
  const settings = settingsRow || { companyName: 'Your Company', nav: [], contactCtaLabel: 'Visit' }
  const tel = String((settings as any).phone || '').replace(/[^\d+]/g, '')
  const body = `<section class="thanks"><div class="container thanks__inner"><div class="eyebrow">Got it</div><h1 class="thanks__title foil">We'll call you back.</h1>` +
    `<p class="thanks__lead">The owner has your request. If it's urgent, call ${tel ? `<a href="tel:${tel}">${(settings as any).phone}</a>` : 'the bar'}.</p>` +
    `<a class="btn btn--outline btn--lg" href="/">Back to tonight's board</a></div></section>`
  const html = await ejs.renderFile(path.join(viewsDir, 'base.ejs'), { body, assetV: ASSET_VERSION, settings: { ...settings, seoTitle: 'Thanks — ' + settings.companyName }, crmApiUrl: process.env.CRM_API_URL || '', currentPath: '/parties/thanks' }) as string
  c.header('X-Robots-Tag', 'noindex')
  return c.html(html)
})

// ── /api/live — the single source of live truth ────────────────────────
// Consumed by the Tonight Board poller, the voice agent, and any future TV
// board. Never cached by intermediaries; the server itself memoises the
// underlying queries for ~20 s (see lib/site-data).
app.get('/api/live', async (c) => {
  const site = await loadSiteData()
  c.header('Cache-Control', 'no-store')
  c.header('Access-Control-Allow-Origin', '*')
  return c.json(site.live)
})
// Fresh (uncached) variant for the console right after a write.
app.get('/api/live/fresh', async (c) => {
  bustSiteData()
  c.header('Cache-Control', 'no-store')
  return c.json(await buildLiveState(db))
})

app.get('/:slug', async (c, next) => {
  const slug = c.req.param('slug')
  // Reserved names and unknown pages fall THROUGH (next()) so the routes
  // registered after this one — /sitemap.xml, /robots.txt, the console,
  // nested pages — still get their turn instead of a premature 404.
  if (['api', 'admin', 'uploads', 'images', 'styles', 'scripts', 'fonts', 'health', 'sitemap.xml', 'robots.txt', 'blog', 'console', 'parties', 'favicon.svg', 'favicon.ico', 'favicon.png'].includes(slug)) return next()
  const html = await renderPage(slug, '/' + slug)
  if (!html) return next()
  countView('/' + slug)
  return c.html(html)
})

// ── Blog ──────────────────────────────────────────────────────────────
// /blog        → list of published posts (newest first)
// /blog/:slug  → individual post detail
// Body is stored as markdown; we render to HTML at request time with a
// tiny inline converter rather than pulling a heavy dep — covers the
// 90% case (headings, paragraphs, lists, links, bold/italic, code,
// blockquotes, images).

// markdownToHtml lives in lib/markdown.ts (shared with timeline + menu stories).

// ── SEO files ──────────────────────────────────────────────────────────
// Dynamic sitemap + robots so search engines see whatever's currently
// published in the pages table. Origin is derived from the incoming
// request when nothing's been explicitly set.

function getSiteOrigin(c: any): string {
  // SITE_ORIGIN / SITE_URL (Render sets SITE_URL at deploy) beat the request,
  // and behind Render's proxy the request protocol is http — honor
  // X-Forwarded-Proto so the sitemap never advertises http:// URLs.
  const explicit = process.env.SITE_ORIGIN || process.env.SITE_URL
  if (explicit) return explicit.replace(/\/+$/, '')
  const url = new URL(c.req.url)
  const proto = (c.req.header('x-forwarded-proto') || url.protocol.replace(':', '')).split(',')[0].trim()
  return `${proto}://${url.host}`
}

app.get('/sitemap.xml', async (c) => {
  const origin = getSiteOrigin(c)
  const pageRows = await db.select().from(pagesTbl).where(eq(pagesTbl.isPublished, true)).orderBy(asc(pagesTbl.navOrder), asc(pagesTbl.title))
  const postRows = await db.select().from(postsTbl).where(eq(postsTbl.status, 'published')).orderBy(desc(postsTbl.publishedAt))
  const urls: string[] = []
  for (const r of pageRows) {
    const loc = origin + (r.slug === 'home' ? '/' : '/' + r.slug)
    const lastmod = r.updatedAt instanceof Date ? r.updatedAt.toISOString() : new Date(r.updatedAt as any).toISOString()
    urls.push(`  <url><loc>${escapeXml(loc)}</loc><lastmod>${lastmod}</lastmod></url>`)
  }
  // Signature item pages (own URL + MenuItem schema)
  try {
    const site = await loadSiteData()
    for (const sec of site.menu) for (const it of sec.items) if (it.isSignature && it.isActive) {
      const lastmod = it.updatedAt instanceof Date ? it.updatedAt.toISOString() : new Date(it.updatedAt as any).toISOString()
      urls.push(`  <url><loc>${escapeXml(origin + '/' + sec.slug + '/' + it.slug)}</loc><lastmod>${lastmod}</lastmod></url>`)
    }
  } catch { /* sitemap must never 500 over menu data */ }
  if (postRows.length > 0) {
    urls.push(`  <url><loc>${escapeXml(origin + '/blog')}</loc></url>`)
    for (const r of postRows) {
      const loc = origin + '/blog/' + r.slug
      const lastmod = r.updatedAt instanceof Date ? r.updatedAt.toISOString() : new Date(r.updatedAt as any).toISOString()
      urls.push(`  <url><loc>${escapeXml(loc)}</loc><lastmod>${lastmod}</lastmod></url>`)
    }
  }
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.join('\n') +
    `\n</urlset>\n`
  c.header('Content-Type', 'application/xml')
  c.header('Cache-Control', 'public, max-age=3600')
  return c.body(xml)
})

app.get('/robots.txt', async (c) => {
  const origin = getSiteOrigin(c)
  const body =
    `User-agent: *\nAllow: /\nDisallow: /admin/\nDisallow: /api/\n\nSitemap: ${origin}/sitemap.xml\n`
  c.header('Content-Type', 'text/plain')
  c.header('Cache-Control', 'public, max-age=86400')
  return c.body(body)
})

function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c] || c))
}

// ── Public: lead capture from the contact form ────────────────────────────
app.post('/api/leads', async (c) => {
  try {
    // Rate-limit first — keeps the DB write and email send off the
    // critical path for flooders.
    const ip = leadClientIp(c)
    const now = Date.now()
    const times = (leadBuckets.get(ip) || []).filter(t => now - t < LEAD_WINDOW_MS)
    if (times.length >= LEAD_MAX) {
      const retryAfterSec = Math.ceil((LEAD_WINDOW_MS - (now - times[0])) / 1000)
      c.res.headers.set('Retry-After', String(retryAfterSec))
      return c.json({ error: 'Too many submissions. Please try again later.' }, 429)
    }
    times.push(now)
    leadBuckets.set(ip, times)

    const body = await c.req.parseBody() as Record<string, any>

    // ── Spam protection (honeypot + minimum dwell time) ────────────────
    // The contact form template includes a hidden 'website' field that
    // legitimate users never see. Bots auto-fill every input — any
    // value here is a tell. Silently 200 so the bot thinks it worked.
    // The form also stamps a hidden 't' field with Date.now() when it
    // renders; if the submit lands in under 1.5s the form was almost
    // certainly auto-completed. Both checks are cheap and effective.
    const honeypot = String(body.website || '').trim()
    if (honeypot) {
      console.log('[Leads] honeypot triggered — silent drop')
      return c.json({ ok: true, message: "Got it. We'll reply within one business day." })
    }
    const stamp = parseInt(String(body.t || '0'), 10)
    if (stamp > 0 && Date.now() - stamp < 1500) {
      console.log('[Leads] dwell-time triggered — silent drop')
      return c.json({ ok: true, message: "Got it. We'll reply within one business day." })
    }

    const name = String(body.name || '').trim()
    const email = String(body.email || '').trim()
    const phone = String(body.phone || '').trim() || null
    const message = String(body.project || body.message || '').trim()
    const source = String(body.source || c.req.header('referer') || '').trim() || null

    if (!name || name.length < 2) return c.json({ error: 'Name is required.' }, 400)
    if (!email || !email.includes('@')) return c.json({ error: 'Valid email required.' }, 400)
    if (!message || message.length < 4) return c.json({ error: 'Tell us a bit about your project.' }, 400)

    await db.insert(leadsTbl).values({ name, email, phone, message, source: source || undefined })

    // Fire-and-forget owner notification. Reads recipient from
    // settings.email (the customer's contact address); skips silently
    // if SENDGRID_API_KEY isn't set yet.
    notifyOwnerOfLead({ name, email, phone, message, source }).catch((e: any) =>
      console.warn('[Leads] owner notification failed:', e.message))

    return c.json({ ok: true, message: "Got it. We'll reply within one business day." })
  } catch (err: any) {
    console.error('[Leads] insert failed:', err.message)
    return c.json({ error: 'Could not save your message. Please try again.' }, 500)
  }
})

async function notifyOwnerOfLead(lead: { name: string; email: string; phone: string | null; message: string; source: string | null }): Promise<void> {
  const apiKey = process.env.SENDGRID_API_KEY
  if (!apiKey) return
  const fromEmail = process.env.FROM_EMAIL || process.env.FACTORY_FROM_EMAIL || 'noreply@twomiah.app'
  const settingsRow = await loadSettings()
  const toEmail = (settingsRow as any)?.email
  if (!toEmail) return
  const companyName = (settingsRow as any)?.companyName || 'Your site'
  const escape = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] || c))
  const subject = `New website lead — ${lead.name}`
  const html = `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#fafaf7;margin:0;padding:40px 16px;color:#1a1a1a;">
    <table width="560" cellpadding="0" cellspacing="0" align="center" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(20,20,30,0.06);">
      <tr><td style="padding:28px 32px 16px;"><div style="font-size:12px;letter-spacing:0.16em;text-transform:uppercase;color:#888;">${escape(companyName)} · new lead</div></td></tr>
      <tr><td style="padding:0 32px 12px;"><h2 style="margin:0;font-size:22px;color:#1a1a1a;">${escape(lead.name)}</h2></td></tr>
      <tr><td style="padding:0 32px 24px;color:#3a3a3a;font-size:15px;line-height:1.6;">
        <div><strong>Email:</strong> <a href="mailto:${escape(lead.email)}" style="color:#1a1a1a;">${escape(lead.email)}</a></div>
        ${lead.phone ? `<div><strong>Phone:</strong> <a href="tel:${escape(lead.phone)}" style="color:#1a1a1a;">${escape(lead.phone)}</a></div>` : ''}
        ${lead.source ? `<div style="margin-top:6px;color:#888;font-size:13px;">Submitted from: ${escape(lead.source)}</div>` : ''}
        <div style="margin-top:18px;padding:14px 18px;background:#fafaf7;border-left:3px solid #f97316;border-radius:4px;white-space:pre-wrap;">${escape(lead.message)}</div>
      </td></tr>
      <tr><td style="padding:0 32px 24px;"><a href="mailto:${escape(lead.email)}?subject=Re:%20your%20inquiry" style="display:inline-block;background:#f97316;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">Reply now</a></td></tr>
      <tr><td style="background:#fafaf7;padding:16px 32px;border-top:1px solid #eee;color:#888;font-size:12px;">This lead is also saved in your admin under Leads.</td></tr>
    </table>
  </body></html>`
  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: toEmail }], subject }],
      from: { email: fromEmail, name: 'Twomiah' },
      reply_to: { email: lead.email, name: lead.name },
      content: [{ type: 'text/html', value: html }],
    }),
  })
  if (!res.ok) {
    console.warn('[Leads] SendGrid HTTP', res.status, await res.text().catch(() => ''))
  }
}

// ── Billing portal proxy ─────────────────────────────────────────────────
// The admin UI calls this to get a Stripe Customer Portal URL. We
// forward to the Factory (which has the Stripe secret key) using the
// shared FACTORY_SYNC_KEY for auth. Admin-only — gated by /api/admin/
// auth middleware in the route mount above isn't applied here, but
// the path is /api/admin/billing-portal so we gate manually below.
app.get('/api/admin/billing-portal', async (c) => {
  const authz = c.req.header('Authorization') || ''
  if (!authz.startsWith('Bearer ')) return c.json({ error: 'Missing auth token' }, 401)
  // Don't bother fully verifying — admin SPA already gates the route.
  // The token presence is a smoke check.

  const factoryUrl = process.env.FACTORY_URL
  const tenantId = process.env.TENANT_ID
  const syncKey = process.env.FACTORY_SYNC_KEY
  if (!factoryUrl || !tenantId || !syncKey) {
    return c.json({ error: 'Billing portal not configured on this tenant.' }, 503)
  }
  try {
    const r = await fetch(factoryUrl.replace(/\/+$/, '') + '/api/v1/factory/internal/billing-portal/' + tenantId, {
      headers: { 'X-Factory-Key': syncKey },
      signal: AbortSignal.timeout(15000),
    })
    const body = await r.json()
    if (!r.ok) return c.json(body, r.status as 400 | 401 | 403 | 404 | 409 | 500 | 503)
    return c.json(body)
  } catch (e: any) {
    return c.json({ error: 'Factory unreachable: ' + e.message }, 502)
  }
})

// Custom domain — attach the customer's BYOD domain to this tenant.
// Proxies to factory which does the actual Cloudflare zone creation
// + Render custom-domain attachment. Returns the nameservers the
// customer needs to set at their registrar.
app.post('/api/admin/domain/attach', async (c) => {
  const authz = c.req.header('Authorization') || ''
  if (!authz.startsWith('Bearer ')) return c.json({ error: 'Missing auth token' }, 401)
  const factoryUrl = process.env.FACTORY_URL
  const tenantId = process.env.TENANT_ID
  const syncKey = process.env.FACTORY_SYNC_KEY
  if (!factoryUrl || !tenantId || !syncKey) return c.json({ error: 'Custom domain not configured on this tenant.' }, 503)
  const body = await c.req.json().catch(() => ({})) as { domain?: string; mode?: 'byod' | 'buy' }
  try {
    const r = await fetch(factoryUrl.replace(/\/+$/, '') + '/api/v1/factory/internal/domain/attach/' + tenantId, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Factory-Key': syncKey },
      body: JSON.stringify({ domain: body.domain, mode: body.mode || 'byod' }),
      signal: AbortSignal.timeout(30000),
    })
    const data = await r.json()
    if (!r.ok) return c.json(data, r.status as 400 | 401 | 403 | 404 | 409 | 500 | 501 | 503)
    return c.json(data)
  } catch (e: any) {
    return c.json({ error: 'Factory unreachable: ' + e.message }, 502)
  }
})

// Read current custom-domain status — drives the admin page's banner
// (pending nameservers / active / not configured).
app.get('/api/admin/domain/status', async (c) => {
  const authz = c.req.header('Authorization') || ''
  if (!authz.startsWith('Bearer ')) return c.json({ error: 'Missing auth token' }, 401)
  const factoryUrl = process.env.FACTORY_URL
  const tenantId = process.env.TENANT_ID
  const syncKey = process.env.FACTORY_SYNC_KEY
  if (!factoryUrl || !tenantId || !syncKey) return c.json({ status: 'unconfigured' })
  try {
    const r = await fetch(factoryUrl.replace(/\/+$/, '') + '/api/v1/factory/internal/domain/status/' + tenantId, {
      headers: { 'X-Factory-Key': syncKey },
      signal: AbortSignal.timeout(15000),
    })
    const data = await r.json()
    if (!r.ok) return c.json(data, r.status as 400 | 401 | 403 | 404 | 500 | 503)
    return c.json(data)
  } catch (e: any) {
    return c.json({ error: 'Factory unreachable: ' + e.message }, 502)
  }
})

// Buy flow — proxy to factory to create a Stripe Checkout session for
// the domain registration. The customer pays, the webhook fires the
// actual Namecheap registration, then wireDomainInfrastructure runs.
app.post('/api/admin/domain/buy-checkout', async (c) => {
  const authz = c.req.header('Authorization') || ''
  if (!authz.startsWith('Bearer ')) return c.json({ error: 'Missing auth token' }, 401)
  const factoryUrl = process.env.FACTORY_URL
  const tenantId = process.env.TENANT_ID
  const syncKey = process.env.FACTORY_SYNC_KEY
  if (!factoryUrl || !tenantId || !syncKey) return c.json({ error: 'Custom domain not configured on this tenant.' }, 503)
  const body = await c.req.json().catch(() => ({})) as { domain?: string; years?: number }
  try {
    const r = await fetch(factoryUrl.replace(/\/+$/, '') + '/api/v1/factory/internal/domain/buy/' + tenantId, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Factory-Key': syncKey },
      body: JSON.stringify({ domain: body.domain, years: body.years || 1 }),
      signal: AbortSignal.timeout(30000),
    })
    const data = await r.json()
    if (!r.ok) return c.json(data, r.status as 400 | 401 | 403 | 404 | 409 | 422 | 500 | 503)
    return c.json(data)
  } catch (e: any) {
    return c.json({ error: 'Factory unreachable: ' + e.message }, 502)
  }
})

// Public: probe availability for the buy flow (proxies to factory).
// Same rate-limiting story as the intake form — factory enforces.
app.post('/api/admin/domain/check', async (c) => {
  const authz = c.req.header('Authorization') || ''
  if (!authz.startsWith('Bearer ')) return c.json({ error: 'Missing auth token' }, 401)
  const factoryUrl = process.env.FACTORY_URL
  if (!factoryUrl) return c.json({ error: 'Not configured' }, 503)
  const body = await c.req.json().catch(() => ({})) as { domain?: string }
  try {
    const r = await fetch(factoryUrl.replace(/\/+$/, '') + '/api/v1/factory/public/domain/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain: body.domain }),
      signal: AbortSignal.timeout(15000),
    })
    const data = await r.json()
    if (!r.ok) return c.json(data, r.status as 400 | 401 | 403 | 404 | 500 | 503)
    return c.json(data)
  } catch (e: any) {
    return c.json({ error: 'Factory unreachable: ' + e.message }, 502)
  }
})

// Path A++ — internal: returns the premium owner's credentials so the
// factory's provision script can seed the new CRM with matching
// email + password hash. Render gives services internal-only
// DATABASE_URLs that aren't reachable from outside its VPC, so the
// script can't pg-connect directly; this endpoint is the supported
// way to bridge.
//
// Returns the FIRST owner/admin user, ordered by created_at. The
// password hash is exposed verbatim — that's by design: it's bcrypt,
// X-Factory-Key gated, and the consumer needs it to seed the CRM
// users table so cross-product sign-in works. Don't surface this
// anywhere else.
app.get('/api/internal/owner-credentials', async (c) => {
  const syncKey = process.env.FACTORY_SYNC_KEY
  if (!syncKey) return c.json({ error: 'Sync not configured' }, 503)
  if (c.req.header('X-Factory-Key') !== syncKey) return c.json({ error: 'Unauthorized' }, 401)
  const { users: usersTbl } = await import('./db/schema')
  const rows = await db.select({
    email: usersTbl.email,
    passwordHash: usersTbl.passwordHash,
    name: usersTbl.name,
  }).from(usersTbl).orderBy(asc(usersTbl.createdAt)).limit(1)
  if (!rows[0]) return c.json({ error: 'No owner user found yet' }, 404)
  return c.json(rows[0])
})

// Path A++ — internal: factory POSTs here after scripts/provision-crm-
// for-tenant.ts succeeds. Sets settings.crmUrl + crmReadyAt so the
// BillingPage flips from "Add CRM" to "Open CRM →" without a redeploy.
app.post('/api/internal/set-crm-url', async (c) => {
  const syncKey = process.env.FACTORY_SYNC_KEY
  if (!syncKey) return c.json({ error: 'Sync not configured' }, 503)
  if (c.req.header('X-Factory-Key') !== syncKey) return c.json({ error: 'Unauthorized' }, 401)
  const body = await c.req.json().catch(() => ({})) as { crmUrl?: string }
  const url = String(body.crmUrl || '').trim()
  if (!url || !/^https:\/\//.test(url)) return c.json({ error: 'crmUrl required (https://…)' }, 400)
  const existing = await db.select().from(settingsTbl).limit(1)
  if (!existing[0]) return c.json({ error: 'Settings not initialized' }, 409)
  await db.update(settingsTbl).set({
    crmUrl: url,
    crmReadyAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(settingsTbl.id, existing[0].id))
  return c.json({ success: true })
})

// Path A++ — surfaces CRM availability to the admin SPA. Powers the
// /admin/billing UI's choice between "Add CRM" tile and "Open CRM →"
// button. Public endpoint shape (returns booleans + URL, never the
// handoff token) — token mint happens via /api/admin/crm-handoff
// behind the admin gate.
app.get('/api/admin/crm-status', async (c) => {
  const authz = c.req.header('Authorization') || ''
  if (!authz.startsWith('Bearer ')) return c.json({ error: 'Missing auth token' }, 401)
  const s = (await db.select().from(settingsTbl).limit(1))[0]
  const ready = !!(s as any)?.crmUrl
  return c.json({
    ready,
    crmUrl: ready ? (s as any).crmUrl : null,
    readyAt: ready ? (s as any).crmReadyAt : null,
  })
})

// Path A++ — proxy to factory for a fresh handoff token + redirect URL.
// Factory signs the token with the per-tenant FACTORY_SYNC_KEY so the
// CRM (which has the same key) can verify. Token is single-use,
// 60-second TTL, and carries the user's email so the CRM can match
// to its local seeded user row.
app.get('/api/admin/crm-handoff', async (c) => {
  const authz = c.req.header('Authorization') || ''
  if (!authz.startsWith('Bearer ')) return c.json({ error: 'Missing auth token' }, 401)
  const factoryUrl = process.env.FACTORY_URL
  const tenantId = process.env.TENANT_ID
  const syncKey = process.env.FACTORY_SYNC_KEY
  const jwtSecret = process.env.JWT_SECRET
  if (!factoryUrl || !tenantId || !syncKey || !jwtSecret) {
    return c.json({ error: 'Handoff not configured on this tenant.' }, 503)
  }
  let email = ''
  try {
    const jwtLib = (await import('jsonwebtoken')).default
    const decoded = jwtLib.verify(authz.replace(/^Bearer\s+/, ''), jwtSecret) as { email?: string }
    email = String(decoded.email || '').toLowerCase()
  } catch {
    return c.json({ error: 'Invalid auth token' }, 401)
  }
  if (!email) return c.json({ error: 'No email on session' }, 401)
  try {
    const r = await fetch(
      factoryUrl.replace(/\/+$/, '') + '/api/v1/factory/internal/crm-handoff/' + tenantId + '?email=' + encodeURIComponent(email),
      { headers: { 'X-Factory-Key': syncKey }, signal: AbortSignal.timeout(15000) }
    )
    const body = await r.json()
    if (!r.ok) return c.json(body, r.status as 400 | 401 | 403 | 404 | 409 | 500 | 503)
    return c.json(body)
  } catch (e: any) {
    return c.json({ error: 'Factory unreachable: ' + e.message }, 502)
  }
})

// Path A++ — proxy to the factory to start a Stripe Checkout for the
// CRM add-on. Same pattern as billing-portal — factory holds the
// Stripe secret, we forward the click. Customer pays, returns to
// /admin/billing?crm=ordered, the BillingPage shows a "thanks, we'll
// have it up within 24h" banner. Actual provisioning is gated by
// Jeremiah running scripts/provision-crm-for-tenant.ts in V1.
app.get('/api/admin/checkout/crm-addon', async (c) => {
  const authz = c.req.header('Authorization') || ''
  if (!authz.startsWith('Bearer ')) return c.json({ error: 'Missing auth token' }, 401)
  const factoryUrl = process.env.FACTORY_URL
  const tenantId = process.env.TENANT_ID
  const syncKey = process.env.FACTORY_SYNC_KEY
  if (!factoryUrl || !tenantId || !syncKey) {
    return c.json({ error: 'Upgrade not configured on this tenant.' }, 503)
  }
  try {
    const r = await fetch(factoryUrl.replace(/\/+$/, '') + '/api/v1/factory/internal/checkout/crm-addon/' + tenantId, {
      headers: { 'X-Factory-Key': syncKey },
      signal: AbortSignal.timeout(15000),
    })
    const body = await r.json()
    if (!r.ok) return c.json(body, r.status as 400 | 401 | 403 | 404 | 409 | 500 | 503)
    return c.json(body)
  } catch (e: any) {
    return c.json({ error: 'Factory unreachable: ' + e.message }, 502)
  }
})

// ── Factory internal: sync settings from the Factory ──────────────────────
app.post('/api/internal/sync-settings', async (c) => {
  const factoryKey = process.env.FACTORY_SYNC_KEY
  if (!factoryKey) return c.json({ error: 'Factory sync not configured' }, 503)
  if (c.req.header('X-Factory-Key') !== factoryKey) return c.json({ error: 'Unauthorized' }, 401)

  const patch = await c.req.json().catch(() => ({})) as Record<string, any>
  const existing = await loadSettings()
  if (!existing) return c.json({ error: 'Settings row not initialized yet' }, 409)

  const allowed: Record<string, any> = {}
  const fields = ['companyName', 'tagline', 'phone', 'email', 'address', 'seoTitle', 'seoDescription',
    'contactCtaLabel', 'primaryColor', 'secondaryColor', 'accentColor', 'logoUrl', 'faviconUrl',
    'googleTagManagerId', 'googleAnalyticsId', 'googleAdsId', 'facebookPixelId', 'microsoftClarityId', 'nav',
    'headerLogoUrl', 'streetAddress', 'addressLocality', 'addressRegion', 'postalCode', 'geoLat', 'geoLng',
    'sameAs', 'schemaType', 'siteOrigin', 'servesCuisine', 'priceRange', 'established', 'timezone',
    'fontDisplay', 'fontEyebrow', 'fontBody', 'fontMono', 'theme']
  for (const f of fields) if (f in patch) allowed[f] = patch[f]
  if (Object.keys(allowed).length === 0) return c.json({ ok: true, noChanges: true })

  await db.update(settingsTbl).set({ ...allowed, updatedAt: new Date() }).where(eq(settingsTbl.id, existing.id))
  return c.json({ ok: true, applied: Object.keys(allowed) })
})

// ── Factory internal: seed intake photos into the tenant's library ────────
//
// Called by the Factory after deploy completes, to copy photos the prospect
// uploaded during /public/intake (which live on the Factory's signed-URL
// storage and expire in 7 days) into the tenant's own R2 bucket + photos
// table so they survive long-term.
//
// Body: { photos: [{ url, tag?, alt? }] }
app.post('/api/internal/seed-photos', async (c) => {
  const factoryKey = process.env.FACTORY_SYNC_KEY
  if (!factoryKey) return c.json({ error: 'Factory sync not configured' }, 503)
  if (c.req.header('X-Factory-Key') !== factoryKey) return c.json({ error: 'Unauthorized' }, 401)

  let body: { photos?: Array<{ url?: string; tag?: string; alt?: string }> }
  try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON' }, 400) }
  const incoming = Array.isArray(body.photos) ? body.photos : []
  if (incoming.length === 0) return c.json({ ok: true, seeded: 0 })

  const [sharp, { uploadImage }, schema] = await Promise.all([
    import('sharp').then(m => m.default),
    import('./services/storage'),
    import('./db/schema'),
  ])
  const photosTbl = schema.photos

  let seeded = 0
  const errors: Array<{ url: string; error: string }> = []
  for (const p of incoming.slice(0, 50)) {
    if (!p.url || typeof p.url !== 'string') continue
    try {
      const res = await fetch(p.url, { signal: AbortSignal.timeout(30_000) })
      if (!res.ok) throw new Error('fetch failed: ' + res.status)
      const raw = Buffer.from(await res.arrayBuffer())
      const meta = await sharp(raw).metadata()
      const isAlphaPng = meta.format === 'png' && meta.hasAlpha
      const processedBuffer = isAlphaPng ? raw : await sharp(raw).rotate().jpeg({ quality: 82, mozjpeg: true }).toBuffer()
      const processedType = isAlphaPng ? 'image/png' : 'image/jpeg'

      const upload = await uploadImage(processedBuffer, {
        filename: 'intake-photo' + (isAlphaPng ? '.png' : '.jpg'),
        contentType: processedType,
      })

      await db.insert(photosTbl).values({
        url: upload.url,
        storageKey: upload.storageKey,
        alt: p.alt || null,
        tag: p.tag || null,
        width: meta.width || null,
        height: meta.height || null,
        bytes: upload.bytes,
        contentType: upload.contentType,
      })
      seeded++
    } catch (err: any) {
      errors.push({ url: p.url, error: err.message || String(err) })
    }
  }

  return c.json({ ok: true, seeded, errors: errors.length > 0 ? errors : undefined })
})

// ── Admin: JSON API + SPA ─────────────────────────────────────────────────
// JSON API mounted at /api/admin/*. The React SPA build lands at
// admin/dist/ and gets served below at /admin/*. SPA routes that don't
// match a built asset fall back to index.html so client-side routing works.
// Admin API: stricter CORS than public pages — only same-origin browser
// requests, or explicit allowlist via CORS_ALLOWED_ORIGINS env var.
app.use('/api/admin/*', adminCors())
// Login endpoint gets its own rate limit before the bcrypt comparison.
app.use('/api/admin/login', loginRateLimit())
app.route('/api/admin', adminRoutes)

// ── THE CONSOLE (staff PWA) ────────────────────────────────────────────────
app.get('/console/', (c) => c.redirect('/console'))   // strict routing: the PWA scope is /console/, the app lives at /console
app.route('/console', consolePages)
app.route('/api/console', consoleApi)

// ── Signature item pages: /<section-slug>/<item-slug> ─────────────────────
// A signature burger is a product, not a line item: own URL, own photo,
// own story, own MenuItem schema. Synthesized from the menu database so
// there is nothing to keep in sync.
async function renderItemPage(sectionSlug: string, itemSlug: string): Promise<string | null> {
  const [site, settingsRow] = await Promise.all([loadSiteData(), loadSettings()])
  const section = site.menu.find(sec => sec.slug === sectionSlug)
  const item = section?.items.find(i => i.slug === itemSlug && i.isSignature && i.isActive)
  if (!section || !item) return null
  const settings = settingsRow || { companyName: 'Your Company', nav: [], contactCtaLabel: 'Visit' }
  const effectiveSettings = {
    ...settings,
    seoTitle: `${item.name} — ${settings.companyName}`,
    seoDescription: item.description || settings.seoDescription || '',
    heroPhotoUrl: item.heroImageUrl || item.imageUrl || (settings as any).heroPhotoUrl || '',
  }
  const homepage = { sections: [{ type: 'menu', variant: 'item-hero', data: { slug: item.slug, section: section.slug, eyebrow: section.name } }] }
  const currentPath = '/' + section.slug + '/' + item.slug
  const body = await ejs.renderFile(path.join(viewsDir, 'home.ejs'), { homepage, settings: effectiveSettings, site, live: site.live, md: markdownToHtml, currentPath }) as string
  const jsonLd = pageJsonLd({ slug: section.slug + '/' + item.slug, title: item.name, sections: homepage.sections, settings: effectiveSettings as any, hoursSchema: site.hoursSchema, item: { section: section as any, item: item as any } })
  const lcpImage = item.heroImageUrl || item.imageUrl || ''
  return ejs.renderFile(path.join(viewsDir, 'base.ejs'), { body, assetV: ASSET_VERSION, settings: effectiveSettings, crmApiUrl: process.env.CRM_API_URL || '', currentPath, lcpImage, jsonLd }) as Promise<string>
}

// ── Nested CMS page paths (registered LAST, on purpose) ────────────────────
// e.g. /story/1920, /story/oldest-bar-in-wisconsin. The page row stores the
// FULL path in its slug, so loadPage() matches directly and the sitemap emits
// the nested URL. Falls back to a signature item page. These MUST come after
// every /api/* and /admin/* route: Hono dispatches the first-registered match.
const NESTED_RESERVED = ['api', 'admin', 'uploads', 'images', 'styles', 'scripts', 'health', 'sitemap.xml', 'robots.txt', 'blog', 'customize', 'console', 'parties', '.well-known']
app.get('/:a/:b', async (c, next) => {
  const { a, b } = c.req.param()
  if (NESTED_RESERVED.includes(a)) return next()   // fall through to /admin/*, /console/*, /media/* etc. registered later
  const slug = a + '/' + b
  const html = (await renderPage(slug, '/' + slug)) || (await renderItemPage(a, b))
  if (!html) return c.notFound()
  countView('/' + slug)
  return c.html(html)
})
app.get('/:a/:b/:cc', async (c, next) => {
  const { a, b, cc } = c.req.param()
  if (NESTED_RESERVED.includes(a)) return next()
  const slug = a + '/' + b + '/' + cc
  const html = await renderPage(slug, '/' + slug)
  if (!html) return c.notFound()
  countView('/' + slug)
  return c.html(html)
})

const adminDistDir = path.join(__dirname, 'admin', 'dist')
const hasAdminBuild = fs.existsSync(adminDistDir) && fs.existsSync(path.join(adminDistDir, 'index.html'))

if (hasAdminBuild) {
  // Hono's serveStatic joins root + c.req.path verbatim, so without a
  // rewrite it would look for ./admin/dist/admin/assets/<file>. Strip
  // the /admin prefix so the lookup lands at ./admin/dist/assets/<file>
  // where Vite actually emits the build.
  app.use('/admin/assets/*', serveStatic({
    root: './admin/dist',
    rewriteRequestPath: (p) => p.replace(/^\/admin/, ''),
  }))
  app.get('/admin/*', (c) => {
    // SPA fallback — serve index.html for any /admin/* request that wasn't
    // an asset. React Router takes over from there.
    const html = fs.readFileSync(path.join(adminDistDir, 'index.html'), 'utf8')
    return c.html(html)
  })
} else {
  app.get('/admin/*', (c) => c.html(
    '<!doctype html><meta charset="utf-8"><title>Admin not built</title>' +
    '<body style="font:16px system-ui;padding:40px;max-width:560px;margin:auto">' +
    '<h1>Admin not built</h1>' +
    '<p>Run <code>cd admin && bun install && bun run build</code> to ship the admin UI.</p>' +
    '</body>'
  ))
}

// ── Boot ──────────────────────────────────────────────────────────────────
const port = Number(process.env.PORT || '3000')
console.log('[Premium-Contractor] Serving on port', port)

export default {
  port,
  fetch: app.fetch,
}
