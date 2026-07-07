import { Hono } from 'hono'
import { registerMedia } from './services/mediaProxy.ts'
import { secureHeaders } from 'hono/secure-headers'
import { cors } from 'hono/cors'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import path from 'path'
import fs from 'fs'
import ejs from 'ejs'
import { fileURLToPath } from 'url'

import adminRoutes from './routes/admin.ts'
import { startSchedule as startBackups } from './services/autoBackup.ts'
import { startSchedule as startInventorySync } from './services/inventoryImport.ts'
import { rebuildMiddleware } from './services/rebuild-middleware.ts'
import appPaths from './config/paths.ts'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = new Hono()
const PORT = parseInt(process.env.PORT || '3000')

const uploadsDir = appPaths.uploads
const BASE_URL = process.env.SITE_URL || '{{SITE_URL}}'

// ===========================================
// MIDDLEWARE
// ===========================================

app.use('*', secureHeaders())

const allowedOrigins = (process.env.CORS_ORIGIN || '').split(',').map(s => s.trim())
app.use('*', cors({
  origin: (origin) => allowedOrigins.includes(origin) ? origin : null,
  credentials: true,
}))

// ──────────────────────────────────────────────────────────────────────────
// URL canonicalization (Claflin 3.10): strip trailing slashes with a 301,
// EXCEPT for the root, API/admin/uploads paths, and an exception set for
// paths Google has chosen as their canonical with-slash form. Adding a path
// to TRAILING_SLASH_KEEP_200 makes both /path and /path/ serve 200 instead
// of one redirecting. Sitemap entries + <link rel="canonical"> tags MUST
// match the no-slash form. Exception rationale: if Google Search Console
// has selected the trailing-slash variant as the canonical for a given URL,
// redirecting it would push Google's preferred form behind a 301 and drop
// the page from the index.
// ──────────────────────────────────────────────────────────────────────────
const TRAILING_SLASH_KEEP_200 = new Set<string>([
  // Add per-deployment paths Google has chosen as canonical-with-slash.
])
app.use('*', async (c, next) => {
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') return next()
  const url = new URL(c.req.url)
  const p = url.pathname
  if (p.startsWith('/api') || p.startsWith('/admin') || p.startsWith('/uploads')) return next()
  if (p.length > 1 && p.endsWith('/') && !TRAILING_SLASH_KEEP_200.has(p)) {
    return c.redirect(p.replace(/\/+$/, '') + url.search, 301)
  }
  return next()
})

// Rate limiting
const rateLimitMap = new Map<string, { count: number; resetAt: number }>()
const contactLimitMap = new Map<string, { count: number; resetAt: number }>()

function rateLimit(map: Map<string, { count: number; resetAt: number }>, max: number, windowMs: number) {
  return async (c: any, next: any) => {
    const ip = c.req.header('x-forwarded-for')?.split(',')[0] || 'unknown'
    const now = Date.now()
    const entry = map.get(ip)
    if (!entry || now > entry.resetAt) {
      map.set(ip, { count: 1, resetAt: now + windowMs })
      return next()
    }
    if (entry.count >= max) {
      return c.json({ success: false, message: 'Too many requests. Please try again later.' }, 429)
    }
    entry.count++
    return next()
  }
}

// ===========================================
// API ROUTES
// ===========================================

app.get('/api/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// Services routes (optional)
let servicesRoutes: any = null
try {
  servicesRoutes = (await import('./routes/services.ts')).default
} catch (e) {
  // No services route file
}
if (servicesRoutes) {
  app.route('/api/services', servicesRoutes)
}

app.use('/api/admin/*', rateLimit(rateLimitMap, 200, 15 * 60 * 1000))
app.use('/api/admin/*', rebuildMiddleware)
app.route('/api/admin', adminRoutes)

// Stricter rate limit on lead submission
app.use('/api/admin/leads', rateLimit(contactLimitMap, 5, 15 * 60 * 1000))

// ===========================================
// STATIC FILES
// ===========================================

// MIME type map for Bun runtime (serveStatic sometimes serves as text/plain)
const MIME_TYPES: Record<string, string> = {
  '.css': 'text/css', '.js': 'application/javascript', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.xml': 'application/xml', '.txt': 'text/plain', '.html': 'text/html',
}

// Serve static files directly from build/ and public/ with correct MIME types
function serveStaticDir(dir: string) {
  return async (c: any, next: any) => {
    const reqPath = new URL(c.req.url).pathname
    const filePath = path.join(dir, reqPath)
    try {
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const ext = path.extname(filePath).toLowerCase()
        const mime = MIME_TYPES[ext] || 'application/octet-stream'
        const body = fs.readFileSync(filePath)
        const longCache = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp', '.woff', '.woff2', '.ttf'].includes(ext)
        const medCache = ['.css', '.js'].includes(ext)
        const cacheControl = longCache ? 'public, max-age=31536000, immutable' : medCache ? 'public, max-age=2592000' : 'public, max-age=86400'
        return c.body(body, 200, { 'Content-Type': mime, 'Cache-Control': cacheControl })
      }
    } catch {}
    return next()
  }
}

// Serve uploaded files
app.use('/uploads/*', serveStatic({ root: path.relative(process.cwd(), path.dirname(uploadsDir)), rewriteRequestPath: (p) => p.replace('/uploads', '/' + path.basename(uploadsDir)) }))
registerMedia(app)

// Website static assets
app.use('/*', serveStaticDir(path.join(__dirname, 'build')))
app.use('/*', serveStaticDir(path.join(__dirname, 'public')))

// CMS admin panel (React SPA)
const adminDist = path.join(__dirname, 'admin', 'dist')
if (fs.existsSync(adminDist)) {
  // Serve static assets (JS, CSS, images) from admin/dist
  app.use('/admin/assets/*', serveStatic({ root: path.relative(process.cwd(), adminDist), rewriteRequestPath: (p) => p.replace('/admin', '') }))
  app.use('/admin/favicon*', serveStatic({ root: path.relative(process.cwd(), adminDist), rewriteRequestPath: (p) => p.replace('/admin', '') }))
  // All other /admin routes serve index.html for React Router
  app.get('/admin', async (c) => {
    const html = fs.readFileSync(path.join(adminDist, 'index.html'), 'utf8')
    return c.html(html)
  })
  app.get('/admin/*', async (c) => {
    const html = fs.readFileSync(path.join(adminDist, 'index.html'), 'utf8')
    return c.html(html)
  })
}

// ===========================================
// DATA HELPERS
// ===========================================

function loadJSON(filename: string) {
  try {
    return JSON.parse(fs.readFileSync(path.join(appPaths.data, filename), 'utf8'))
  } catch (e) { return null }
}

const hasVisualizer = !!process.env.VISION_URL
const hasEstimator = process.env.HAS_ESTIMATOR === 'true'

// Defensive escapers for JSON-LD blocks. Admin-edited fields (titles,
// descriptions, addresses) can contain quotes, newlines, or HTML — emit them
// through _jsonStr inside <script type="application/ld+json"> so the structured
// data block never breaks Google's parser. _plainDesc strips tags + decodes
// common entities for description fields. See Claflin backport 3.6.
const _jsonStr = (v: any) => JSON.stringify(v == null ? '' : String(v))
const _plainDesc = (html: any, max = 300) => String(html || '')
  .replace(/<[^>]*>/g, ' ')
  .replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&(#x27|#39|apos);/gi, "'")
  .replace(/&(quot|#34);/gi, '"')
  .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
  .replace(/&[a-z]+;/gi, ' ')
  .replace(/\s+/g, ' ')
  .trim().slice(0, max)

// Loads image-meta.json once per call. Used by both wrapImagesWithPicture
// (post-render <img> rewrite) and bgWithWebp (EJS-time CSS background).
function loadImageMeta(): Record<string, { hasWebp?: boolean; width?: number; height?: number }> {
  try {
    const metaFile = path.join(appPaths.data, 'image-meta.json')
    if (fs.existsSync(metaFile)) return JSON.parse(fs.readFileSync(metaFile, 'utf8'))
  } catch {}
  return {}
}

// CSS-background image-set helper (Claflin 3.9). Given a uploaded image URL,
// returns either an image-set() that prefers WebP and falls back to the
// original, or a plain url() if no WebP companion exists. Use in EJS as:
//   style="background-image: <%- bgWithWebp(getImageUrl(hero.image)) %>"
function bgWithWebp(imgUrl: string): string {
  if (!imgUrl || typeof imgUrl !== 'string') return ''
  // Static /images/*.jpg|png with a generated .webp companion → image-set (prefer WebP).
  const staticWebp = localWebpUrl(imgUrl)
  if (staticWebp) {
    const st = /\.png$/i.test(imgUrl) ? 'image/png' : 'image/jpeg'
    return `image-set(url('${staticWebp}') type('image/webp'), url('${imgUrl}') type('${st}'))`
  }
  // Only rewrite locally-served raster uploads — leave external URLs and SVGs alone.
  const m = imgUrl.match(/^\/uploads\/([^?#]+\.(?:jpe?g|png))$/i)
  if (!m) return `url('${imgUrl}')`
  const filename = m[1]
  const meta = loadImageMeta()[filename]
  if (!meta?.hasWebp) return `url('${imgUrl}')`
  const webpUrl = imgUrl.replace(/\.(jpe?g|png)$/i, '.webp')
  const sourceType = /\.png$/i.test(imgUrl) ? 'image/png' : 'image/jpeg'
  return `image-set(url('${webpUrl}') type('image/webp'), url('${imgUrl}') type('${sourceType}'))`
}

// Resolve the hero image to the URL the browser will actually paint (prefer the
// WebP companion for local uploads) so the LCP <link rel=preload> matches the hero
// background-image instead of a hardcoded guess. Mirrors getImageUrl() in the views.
function resolveHeroPreload(imgRaw: string): string {
  if (!imgRaw || typeof imgRaw !== 'string') return ''
  const url = imgRaw.startsWith('http') || imgRaw.startsWith('/') ? imgRaw : '/uploads/' + imgRaw
  const staticWebp = localWebpUrl(url)
  if (staticWebp) return staticWebp
  const m = url.match(/^\/uploads\/([^?#]+\.(?:jpe?g|png))$/i)
  if (!m) return url
  const meta = loadImageMeta()[m[1]]
  return meta?.hasWebp ? url.replace(/\.(jpe?g|png)$/i, '.webp') : url
}

// For a static /images/*.jpg|png URL, return the .webp URL if a companion file
// exists on disk (build/ or public/), else ''. Used by bgWithWebp + the hero preload.
function localWebpUrl(url: string): string {
  if (typeof url !== 'string') return ''
  const m = url.match(/^\/images\/([^?#]+\.(?:jpe?g|png))$/i)
  if (!m) return ''
  const webpRel = m[1].replace(/\.(jpe?g|png)$/i, '.webp')
  for (const base of ['build', 'public']) {
    try { if (fs.existsSync(path.join(__dirname, base, 'images', webpRel))) return '/images/' + webpRel } catch {}
  }
  return ''
}

// Startup pass: generate WebP companions for static /images raster assets that lack
// one (e.g. the per-tenant hero.jpg, which isn't run through the /uploads pipeline).
// Idempotent — skips files that already have a .webp. sharp is a dependency.
async function ensureStaticWebp() {
  try {
    const sharp = (await import('sharp')).default
    for (const base of ['build', 'public']) {
      const dir = path.join(__dirname, base, 'images')
      if (!fs.existsSync(dir)) continue
      for (const file of fs.readdirSync(dir)) {
        if (!/\.(jpe?g|png)$/i.test(file)) continue
        const out = path.join(dir, file.replace(/\.(jpe?g|png)$/i, '.webp'))
        if (fs.existsSync(out)) continue
        try { await sharp(path.join(dir, file)).webp({ quality: 80 }).toFile(out); console.log('[WebP] generated', file) }
        catch (e: any) { console.error('[WebP]', file, e?.message) }
      }
    }
  } catch (e: any) { console.error('[WebP] sharp unavailable:', e?.message) }
}

// Post-render pass (Claflin 3.4 + 3.5): for every <img src="/uploads/*.jpg|png">,
// inject width/height attrs (CLS fix) and wrap in <picture> with a WebP
// <source> if a companion was generated at upload time. Reads dimensions +
// hasWebp from image-meta.json (written by the /upload route). Idempotent —
// it leaves <img>s already inside <picture> alone.
function wrapImagesWithPicture(html: string): string {
  let imageMeta: Record<string, { hasWebp?: boolean; width?: number; height?: number }> = {}
  try {
    const metaFile = path.join(appPaths.data, 'image-meta.json')
    if (fs.existsSync(metaFile)) imageMeta = JSON.parse(fs.readFileSync(metaFile, 'utf8'))
  } catch {}

  return html.replace(
    /<img\b([^>]*?\bsrc=["'](\/uploads\/([^"'\/]+\.(?:jpe?g|png)))["'][^>]*?)\s*\/?>/gi,
    (match, attrs, fullSrc, filename) => {
      const meta = imageMeta[filename] || {}
      let newAttrs: string = attrs
      // Inject width/height if missing — only when we actually know them
      if (meta.width && meta.height && !/\bwidth=/i.test(attrs)) {
        newAttrs = ` width="${meta.width}" height="${meta.height}"${attrs}`
      }
      let imgTag = `<img${newAttrs}>`
      // Wrap in <picture> with a WebP <source> if a companion exists
      if (meta.hasWebp) {
        const webpSrc = fullSrc.replace(/\.(jpe?g|png)$/i, '.webp')
        imgTag = `<picture><source srcset="${webpSrc}" type="image/webp">${imgTag}</picture>`
      }
      return imgTag
    }
  )
}

// Persistent-disk migration scaffold (Claflin 3.11 + 3.12). Each migration
// is a one-shot, flag-file-gated runner — once the marker file is written
// it never re-runs, so this is safe to leave in startup. The marker is
// written regardless of success so a failed migration doesn't loop; manual
// intervention is required to retry. Add new migrations as objects in the
// `migrations` array. Use cases: sync repo content into persistent
// pages.json, backfill WebP companions for pre-existing /uploads/ files,
// seed binary assets, self-heal broken admin-set image refs. The 3.12
// idempotent-sidecar pattern (drop a marker like .larger next to a file so
// future builds skip a deterministic-no-op check) is already used in the
// /upload route's WebP-size guard.
async function runMigrations() {
  const migrations: Array<{ name: string; fn: () => Promise<void> }> = [
    // Add one-shot migrations here. Example:
    //   { name: 'backfill-webp-v1', fn: async () => { /* scan uploads/ */ } }
  ]
  for (const m of migrations) {
    const marker = path.join(appPaths.data, `.migration-${m.name}`)
    if (fs.existsSync(marker)) continue
    console.log(`[Migration] Running ${m.name}...`)
    try {
      await m.fn()
      console.log(`[Migration] ${m.name} complete`)
    } catch (err: any) {
      console.error(`[Migration] ${m.name} failed:`, err?.message)
    } finally {
      try { fs.writeFileSync(marker, new Date().toISOString()) } catch {}
    }
  }
}

function renderPage(c: any, pageView: string, locals: Record<string, any> = {}, statusCode = 200) {
  const settings = loadJSON('settings.json') || {}
  const navConfig = loadJSON('nav-config.json') || {}
  const menuItems = Array.isArray(navConfig.items) ? navConfig.items : Array.isArray(navConfig) ? navConfig : []
  const shared = { settings, menuItems, BASE_URL, hasVisualizer, hasEstimator, _jsonStr, _plainDesc, bgWithWebp, ...locals }
  const pageFile = path.join(__dirname, 'views', pageView + '.ejs')

  return new Promise<Response>((resolve) => {
    ejs.renderFile(pageFile, shared, (err: any, body: string) => {
      if (err) {
        console.error('EJS page error:', err.message)
        resolve(c.text('Render error', 500))
        return
      }
      const layoutFile = path.join(__dirname, 'views', 'base.ejs')
      ejs.renderFile(layoutFile, { ...shared, body }, (err2: any, html: string) => {
        if (err2) {
          console.error('EJS layout error:', err2.message)
          resolve(c.text('Render error', 500))
          return
        }
        resolve(c.html(wrapImagesWithPicture(html), statusCode))
      })
    })
  })
}

// ===========================================
// PAGE ROUTES
// ===========================================

app.get('/', (c) => {
  const homepage = loadJSON('homepage.json') || {}
  const services = loadJSON('services.json') || []
  const testimonials = loadJSON('testimonials.json') || []
  const settings = loadJSON('settings.json') || {}
  const gallery = loadJSON('gallery.json') || []
  const featuredProjects = gallery.filter((p: any) => p.featured !== false).slice(0, 6)
  const posts = loadJSON('posts.json') || []
  const recentPosts = posts.filter((p: any) => p.published).slice(0, 3)
  const navConfig = loadJSON('nav-config.json') || {}
  const menuItems = (navConfig.items || []).filter((i: any) => i.visible !== false)
  return renderPage(c, 'home', {
    homepage, services, testimonials, featuredProjects, recentPosts, menuItems,
    heroPreloadUrl: resolveHeroPreload(homepage?.hero?.image || ''),
    title: settings.seoTitle || settings.companyName || '{{COMPANY_NAME}}',
    description: settings.seoDescription || (homepage && homepage.hero && homepage.hero.description) || (homepage && homepage.seoDescription) || settings.companyName || '{{COMPANY_NAME}}',
    canonicalUrl: BASE_URL + '/',
  })
})

// Dynamic sitemap — includes live inventory units, services, and blog posts so
// search engines index unit detail pages (replaces the old static sitemap.xml).
app.get('/sitemap.xml', (c) => {
  const base = BASE_URL.replace(/\/$/, '')
  const esc = (u: string) => u.replace(/&/g, '&amp;')
  const urls: string[] = ['/', '/about', '/contact', '/gallery', '/blog', '/inventory', '/services/financing']
  const services = (loadJSON('services.json') || []).filter((s: any) => s && s.visible !== false)
  for (const s of services) if (s.slug) urls.push('/services/' + s.slug)
  const units = (loadJSON('inventory.json') || []).filter((u: any) => u && u.status !== 'sold')
  for (const u of units) urls.push('/inventory/' + (u.stockNumber || u.id))
  const posts = (loadJSON('posts.json') || []).filter((p: any) => p && p.published)
  for (const p of posts) if (p.slug) urls.push('/blog/' + p.slug)
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map((u) => '  <url><loc>' + esc(base + u) + '</loc></url>').join('\n') +
    '\n</urlset>\n'
  return c.body(xml, 200, { 'Content-Type': 'application/xml' })
})

// Dedicated financing page (calculator + pre-qual) — must precede /services/:slug
app.get('/services/financing', (c) => {
  return renderPage(c, 'financing', {
    title: 'Financing | {{COMPANY_NAME}}',
    description: 'Estimate your monthly payment and get pre-qualified for RV & powersports financing at {{COMPANY_NAME}}.',
    canonicalUrl: BASE_URL + '/services/financing',
  })
})

app.get('/services/:slug', (c) => {
  const slug = c.req.param('slug')
  const services = loadJSON('services.json') || []
  let service = services.find((s: any) => s.slug === slug)
  if (!service) {
    // Generate a default service page from the slug instead of 404
    const name = slug.replace(/-/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())
    service = {
      id: slug, slug, name, title: name,
      shortDescription: `Professional ${name.toLowerCase()} services for your home.`,
      description: `{{COMPANY_NAME}} provides expert ${name.toLowerCase()} services throughout {{SERVICE_REGION}}. Contact us today for a free estimate.`,
      icon: 'wrench', image: '',
      features: ['Free estimates', 'Licensed and insured', 'Quality workmanship guarantee', 'Experienced professionals'],
      links: [], offerings: [], faqs: [],
      seoTitle: `${name} | {{COMPANY_NAME}}`,
      seoDescription: `Professional ${name.toLowerCase()} services in {{CITY}}, {{STATE}} by {{COMPANY_NAME}}.`,
      visible: true, order: 99
    }
  }
  return renderPage(c, 'service', {
    service, services,
    title: service.seoTitle || service.name + ' | {{COMPANY_NAME}}',
    description: service.seoDescription || service.shortDescription || '',
    canonicalUrl: BASE_URL + '/services/' + service.slug,
  })
})

// ─── Inventory (units) — reads data/inventory.json (kept fresh by the DMS importer) ──
app.get('/inventory', (c) => {
  const all = (loadJSON('inventory.json') || []).filter((u: any) => u && u.status !== 'sold')
  const q = c.req.query()
  const lc = (v: any) => String(v ?? '').toLowerCase()
  const priceOf = (u: any) => Number(u.internetPrice || u.listedPrice || u.msrp || 0)
  let units = all
  if (q.category) units = units.filter((u: any) => lc(u.category) === lc(q.category))
  if (q.condition) units = units.filter((u: any) => lc(u.condition) === lc(q.condition))
  if (q.make) units = units.filter((u: any) => lc(u.make) === lc(q.make))
  if (q.year) units = units.filter((u: any) => String(u.year) === String(q.year))
  if (q.minPrice) units = units.filter((u: any) => priceOf(u) >= Number(q.minPrice))
  if (q.maxPrice) units = units.filter((u: any) => priceOf(u) <= Number(q.maxPrice))
  if (q.search) { const s = lc(q.search); units = units.filter((u: any) => lc([u.year, u.make, u.modelName, u.trim, u.stockNumber, u.description].join(' ')).includes(s)) }
  const facet = (f: string) => Array.from(new Set(all.map((u: any) => u[f]).filter(Boolean))).sort()
  return renderPage(c, 'inventory-list', {
    units, total: units.length, query: q,
    makes: facet('make'), categories: facet('category'), conditions: facet('condition'),
    title: 'Inventory | {{COMPANY_NAME}}',
    description: 'Browse new & used RVs, ATVs, UTVs and boats in stock at {{COMPANY_NAME}} in {{CITY}}, {{STATE}}.',
    canonicalUrl: BASE_URL + '/inventory',
  })
})

app.get('/inventory/:stock', (c) => {
  const stock = c.req.param('stock')
  const all = loadJSON('inventory.json') || []
  const unit = all.find((u: any) => String(u.id) === stock || String(u.stockNumber) === stock || String(u.vin) === stock)
  if (!unit) return c.redirect('/inventory', 302)
  const title = [unit.year, unit.make, unit.modelName, unit.trim].filter(Boolean).join(' ')
  return renderPage(c, 'inventory-detail', {
    unit,
    relatedUnits: all.filter((u: any) => u.category === unit.category && u.id !== unit.id && u.status !== 'sold').slice(0, 3),
    title: (title || 'Unit') + ' | {{COMPANY_NAME}}',
    description: String(unit.description || title).slice(0, 300),
    canonicalUrl: BASE_URL + '/inventory/' + (unit.stockNumber || unit.id),
  })
})

// Public JSON feed for ads / external consumers
app.get('/api/inventory', (c) => {
  const all = (loadJSON('inventory.json') || []).filter((u: any) => u && (u.status === 'available' || u.status === 'pending'))
  return c.json({ count: all.length, units: all })
})

// ─── AI sales chatbot ─────────────────────────────────────────────────────────
// Claude-powered assistant that knows the live inventory + dealership, answers
// visitor questions, and captures a lead (the proactive "convert the visitor" piece).
app.post('/api/chat', async (c) => {
  let body: any = {}; try { body = await c.req.json() } catch {}
  const messages = Array.isArray(body.messages) ? body.messages.slice(-12) : []
  if (!messages.length) return c.json({ error: 'No message' }, 400)

  const settings = loadJSON('settings.json') || {}
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return c.json({ reply: `Our chat assistant is offline right now — call us at ${settings.phone || 'the store'} or use the contact form and we'll get right back to you!` })

  const inv = (loadJSON('inventory.json') || []).filter((u: any) => u && u.status !== 'sold')
  const byCat = inv.reduce((a: any, u: any) => { a[u.category] = (a[u.category] || 0) + 1; return a }, {})
  const invList = inv.slice(0, 60).map((u: any) => `${u.year || ''} ${u.make} ${u.modelName} — ${u.category}, ${u.condition}, ${u.internetPrice ? '$' + Number(u.internetPrice).toLocaleString() : 'call for price'} (stk# ${u.stockNumber || u.id})`).join('\n')

  const system = `You are the friendly AI sales assistant for ${settings.companyName || 'our dealership'}, a powersports / marine / RV dealership in ${settings.city || ''}, ${settings.state || ''} (phone ${settings.phone || ''}). Help visitors find the right unit and BOOK THE NEXT STEP — be warm, concise, and enthusiastic, like a great salesperson, never robotic.
RULES: Use ONLY the live inventory below — recommend specific units by year/make/model + price + stock#. Never invent units or prices. When a visitor shows real interest, naturally ask for their FIRST NAME and a PHONE or EMAIL so a salesperson can follow up, hold the unit, or start financing.
Once you actually have a name AND a phone or email, end your reply with this hidden tag on its own final line (the website strips it before display): [LEAD]{"name":"...","phone":"...","email":"...","interest":"..."}[/LEAD]
INVENTORY (${inv.length} units; by category ${JSON.stringify(byCat)}):
${invList}`

  let reply = ''
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001', max_tokens: 600, system, messages: messages.map((m: any) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '').slice(0, 1500) })) }),
    })
    if (!res.ok) throw new Error('ai ' + res.status)
    const data: any = await res.json()
    reply = data?.content?.[0]?.text || "Sorry, I didn't catch that — could you say it another way?"
  } catch (e) {
    return c.json({ reply: `I'm having a quick hiccup — please call us at ${settings.phone || 'the store'} and we'll help you right away!` })
  }

  // Capture a lead: write locally + forward to the CRM (where the AI Lead Responder
  // can act on it) — the same path the contact form uses.
  const doCapture = async (lead: any) => {
    if (!lead || !lead.name || !(lead.phone || lead.email)) return false
    const leadObj = { name: String(lead.name).slice(0, 80), phone: String(lead.phone || '').slice(0, 40), email: String(lead.email || '').slice(0, 120), service: 'Website Chat', leadType: 'chat', source: 'website_chat', unitOfInterest: String(lead.interest || '').slice(0, 120), message: 'Captured by the AI chat assistant' }
    appendLead(leadObj)
    const crmUrl = process.env.CRM_API_URL, secret = process.env.WEBHOOK_SECRET || process.env.JWT_SECRET
    if (crmUrl && secret) { try { await fetch(crmUrl.replace(/\/$/, '') + '/api/webhooks/leads', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-webhook-secret': secret }, body: JSON.stringify(leadObj) }) } catch {} }
    return true
  }

  let captured = false
  const mk = reply.match(/\[LEAD\]([\s\S]*?)\[\/LEAD\]/)
  if (mk) {
    reply = reply.replace(/\[LEAD\][\s\S]*?\[\/LEAD\]/, '').trim()
    try { captured = await doCapture(JSON.parse(mk[1])) } catch {}
  }
  // Fallback — the model is flaky about emitting the tag, so if the visitor clearly
  // gave a phone or email, extract it ourselves and capture. Never drop a real lead.
  if (!captured) {
    const conv = messages.filter((m: any) => m.role === 'user').map((m: any) => String(m.content || '')).join('\n')
    if (/\d{3}[-.\s]?\d{3}[-.\s]?\d{4}/.test(conv) || /[\w.+-]+@[\w-]+\.[a-z]{2,}/i.test(conv)) {
      try {
        const ex = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 200, system: 'Extract the visitor’s contact details from this dealership chat. Output ONLY raw JSON: {"name":"","phone":"","email":"","interest":""}. Use an empty string for anything not provided. No other text.', messages: [{ role: 'user', content: conv.slice(0, 2000) }] }),
        })
        const exd: any = await ex.json(); const jm = (exd?.content?.[0]?.text || '').match(/\{[\s\S]*\}/)
        if (jm) captured = await doCapture(JSON.parse(jm[0]))
      } catch {}
    }
  }
  return c.json({ reply, captured })
})

// ─── Reserve a unit ──────────────────────────────────────────────────────────
// Always captures the reservation as a lead. If the dealer has configured Stripe
// (data/reserve-config.json: { enabled, stripeSecretKey, depositAmount, currency }),
// it also creates a Stripe Checkout Session for the deposit and returns its URL.
function appendLead(lead: any) {
  try {
    const f = path.join(appPaths.data, 'leads.json')
    let leads: any[] = []
    try { leads = JSON.parse(fs.readFileSync(f, 'utf8')) } catch {}
    if (!Array.isArray(leads)) leads = []
    leads.unshift({ id: 'lead-' + Date.now() + '-' + Math.round(Math.random() * 1e6), submittedAt: new Date().toISOString(), status: 'new', ...lead })
    fs.writeFileSync(f, JSON.stringify(leads, null, 2))
  } catch (e) { console.error('[Reserve] lead write failed:', e) }
}

app.post('/reserve/:stock', async (c) => {
  const stock = c.req.param('stock')
  const units = loadJSON('inventory.json') || []
  const unit = units.find((u: any) => String(u.stockNumber) === stock || String(u.id) === stock)
  if (!unit) return c.json({ error: 'Unit not found' }, 404)
  let body: any = {}
  try { body = await c.req.json() } catch {}
  const title = [unit.year, unit.make, unit.modelName].filter(Boolean).join(' ')

  appendLead({
    name: body.name || '', email: body.email || '', phone: body.phone || '',
    service: 'Unit Reservation', leadType: 'reservation', source: 'inventory-detail',
    unitOfInterest: title + ' (Stock #' + (unit.stockNumber || stock) + ')',
    message: body.message || 'Reservation request',
  })

  const cfg = loadJSON('reserve-config.json') || {}
  if (cfg.enabled && cfg.stripeSecretKey) {
    const deposit = Math.round(Number(cfg.depositAmount || 500) * 100)
    const base = BASE_URL.replace(/\/$/, '')
    const p = new URLSearchParams()
    p.append('mode', 'payment')
    p.append('success_url', base + '/reserve/success?stock=' + encodeURIComponent(stock))
    p.append('cancel_url', base + '/inventory/' + stock)
    p.append('line_items[0][price_data][currency]', cfg.currency || 'usd')
    p.append('line_items[0][price_data][product_data][name]', 'Reservation Deposit — ' + title)
    p.append('line_items[0][price_data][unit_amount]', String(deposit))
    p.append('line_items[0][quantity]', '1')
    if (body.email) p.append('customer_email', body.email)
    p.append('metadata[stockNumber]', String(unit.stockNumber || stock))
    p.append('metadata[reservedBy]', body.name || '')
    try {
      const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + cfg.stripeSecretKey, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: p,
      })
      const session = await r.json() as any
      if (session.url) return c.json({ checkoutUrl: session.url })
      return c.json({ error: session.error?.message || 'Stripe error', leadCaptured: true }, 400)
    } catch (e: any) {
      return c.json({ error: e.message, leadCaptured: true }, 400)
    }
  }
  // No deposit configured — reservation lead captured; dealer follows up to collect a deposit.
  return c.json({ ok: true, fallback: true })
})

app.get('/reserve/success', (c) => {
  return renderPage(c, 'reserve-success', {
    title: 'Reservation Confirmed | {{COMPANY_NAME}}',
    description: 'Your reservation deposit was received.',
    canonicalUrl: BASE_URL + '/reserve/success',
  })
})

// ─── Parts & accessories request page ──────────────────────────────────────────
app.get('/parts', (c) => {
  return renderPage(c, 'parts', {
    title: 'Parts & Accessories | {{COMPANY_NAME}}',
    description: 'Request OEM and aftermarket parts and accessories from {{COMPANY_NAME}}.',
    canonicalUrl: BASE_URL + '/parts',
  })
})

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

function loadAreas() {
  const areas = loadJSON('service-areas.json') || []
  return areas.map((a: any) => ({ ...a, slug: a.slug || slugify(a.name) }))
}

app.get('/service-areas', (c) => {
  const areas = loadAreas()
  const services = loadJSON('services.json') || []
  return renderPage(c, 'service-areas-index', {
    areas, services,
    title: 'Areas We Serve | {{COMPANY_NAME}}',
    description: '{{COMPANY_NAME}} provides professional services throughout {{SERVICE_REGION}} and surrounding communities.',
    canonicalUrl: BASE_URL + '/service-areas',
  })
})

app.get('/service-area/:slug', (c) => {
  const slug = slugify(decodeURIComponent(c.req.param('slug')))
  const areas = loadAreas()
  const area = areas.find((a: any) => a.slug === slug)
  if (!area) return c.text('Area not found', 404)
  const services = loadJSON('services.json') || []
  return renderPage(c, 'service-area', {
    area, allAreas: areas, services,
    title: `${area.name}, ${area.state} Services | {{COMPANY_NAME}}`,
    description: area.description || `Professional services in ${area.name}, ${area.state} by {{COMPANY_NAME}}.`,
    canonicalUrl: BASE_URL + '/service-area/' + area.slug,
  })
})

app.get('/privacy', (c) => renderPage(c, 'privacy', {
  title: 'Privacy Policy | {{COMPANY_NAME}}',
  description: 'How {{COMPANY_NAME}} collects, uses, and protects your information, including SMS/text messaging.',
  canonicalUrl: BASE_URL + '/privacy',
}))

app.get('/terms', (c) => renderPage(c, 'terms', {
  title: 'Terms of Service | {{COMPANY_NAME}}',
  description: 'The terms governing the {{COMPANY_NAME}} website and services, including our SMS messaging program.',
  canonicalUrl: BASE_URL + '/terms',
}))

app.get('/about', (c) => {
  return renderPage(c, 'about', {
    title: 'About Us | {{COMPANY_NAME}}',
    description: 'Learn about {{COMPANY_NAME}} — {{SERVICE_REGION}}\'s RV & powersports dealership for sales, service, parts and financing.',
    canonicalUrl: BASE_URL + '/about',
  })
})

app.get('/contact', (c) => {
  const services = loadJSON('services.json') || []
  return renderPage(c, 'contact', {
    services, selectedService: c.req.query('service') || '',
    title: 'Contact Us | {{COMPANY_NAME}}',
    description: 'Get in touch for a free estimate.',
    canonicalUrl: BASE_URL + '/contact',
  })
})

app.get('/gallery', (c) => {
  const gallery = loadJSON('gallery.json') || []
  return renderPage(c, 'gallery', {
    gallery,
    title: 'Gallery | {{COMPANY_NAME}}',
    description: 'See our completed projects.',
    canonicalUrl: BASE_URL + '/gallery',
  })
})

app.get('/blog', (c) => {
  const posts = (loadJSON('posts.json') || []).filter((p: any) => p.published !== false)
  return renderPage(c, 'blog', {
    posts,
    title: 'Blog | {{COMPANY_NAME}}',
    description: 'News, tips, and project updates.',
    canonicalUrl: BASE_URL + '/blog',
  })
})

app.get('/blog/:slug', (c) => {
  const slug = c.req.param('slug')
  const posts = loadJSON('posts.json') || []
  const post = posts.find((p: any) => p.slug === slug)
  if (!post) return c.text('Post not found', 404)
  return renderPage(c, 'blog-post', {
    post, posts,
    title: post.seoTitle || post.title + ' | {{COMPANY_NAME}}',
    description: post.seoDescription || post.excerpt || '',
    canonicalUrl: BASE_URL + '/blog/' + post.slug,
  })
})

app.get('/p/:pageId', (c) => {
  const pageId = c.req.param('pageId')
  const pages = loadJSON('pages.json') || {}
  const page = pages[pageId]
  if (!page) return c.text('Page not found', 404)
  return renderPage(c, 'custom-page', {
    page,
    title: page.seoTitle || page.title || pageId,
    description: page.seoDescription || '',
    canonicalUrl: BASE_URL + '/p/' + pageId,
  })
})

// ===========================================
// VISUALIZER PAGE
// ===========================================

const VISION_URL = process.env.VISION_URL || ''
const TENANT_SLUG = process.env.TENANT_SLUG || '{{COMPANY_SLUG}}'

app.get('/visualize', (c) => {
  if (!VISION_URL) return c.redirect('/', 302)
  const services = loadJSON('services.json') || []
  return renderPage(c, 'visualize', {
    VISION_URL,
    TENANT_SLUG,
    services,
    title: 'Visualize Your Project | {{COMPANY_NAME}}',
    description: 'Upload a photo of your home and preview different materials, colors, and styles before any work begins.',
    canonicalUrl: BASE_URL + '/visualize',
  })
})

const CRM_API_URL = process.env.CRM_API_URL || ''

app.get('/estimate', (c) => {
  if (!CRM_API_URL) return c.redirect('/contact', 302)
  const services = loadJSON('services.json') || []
  return renderPage(c, 'estimator', {
    CRM_API_URL,
    TENANT_SLUG,
    services,
    title: 'Instant Roof Estimate | {{COMPANY_NAME}}',
    description: 'Get a free satellite-based roof cost estimate in seconds. No appointment needed.',
    canonicalUrl: BASE_URL + '/estimate',
  })
})

// ===========================================
// ERROR HANDLING
// ===========================================

app.all('/api/*', (c) => {
  return c.json({ success: false, message: 'Endpoint not found' }, 404)
})

app.onError((err, c) => {
  console.error('Server error:', err)
  if (c.req.path.startsWith('/api/')) {
    return c.json({
      success: false,
      message: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message
    }, 500)
  }
  return c.text('Something went wrong. Please try again.', 500)
})

// ===========================================
// START SERVER
// ===========================================

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`
Server running on port ${PORT}
Environment: ${process.env.NODE_ENV || 'development'}
Uploads: ${uploadsDir}
Mode: Server-rendered (EJS) + CMS Admin
  `)

  startBackups()
  startInventorySync()
  // One-shot persistent-disk migrations (3.11) — flag-file-gated so they
  // only fire on first boot after a deploy that adds them. Deferred so a
  // slow migration doesn't delay the health check.
  setTimeout(() => { runMigrations() }, 5000)
  // WebP companions for static /images run AFTER the port is open (deferred,
  // fire-and-forget) — NEVER before serve(), so a slow sharp conversion on a cold
  // start can't delay the server from responding (that showed up as 502s on wake).
  // The hero gracefully serves the JPG until the WebP exists.
  setTimeout(() => { ensureStaticWebp() }, 8000)
})
