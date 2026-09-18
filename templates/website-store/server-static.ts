import { Hono } from 'hono'
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
        return c.body(body, 200, { 'Content-Type': mime, 'Cache-Control': 'public, max-age=86400' })
      }
    } catch {}
    return next()
  }
}

// Serve uploaded files
app.use('/uploads/*', serveStatic({ root: path.relative(process.cwd(), path.dirname(uploadsDir)), rewriteRequestPath: (p) => p.replace('/uploads', '/' + path.basename(uploadsDir)) }))

// Website static assets
app.use('/*', serveStaticDir(path.join(__dirname, 'build')))
app.use('/*', serveStaticDir(path.join(__dirname, 'public')))

// CMS admin panel (React SPA)
const adminDist = path.join(__dirname, 'admin', 'dist')
if (fs.existsSync(adminDist)) {
  app.use('/admin/assets/*', serveStatic({ root: path.relative(process.cwd(), adminDist), rewriteRequestPath: (p) => p.replace('/admin', '') }))
  app.use('/admin/favicon*', serveStatic({ root: path.relative(process.cwd(), adminDist), rewriteRequestPath: (p) => p.replace('/admin', '') }))
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

// ── Store / commerce ────────────────────────────────────────────────────────
// The storefront is DB-free: catalog + checkout + order lookups come from the
// separate crm-store backend PUBLIC API. Marketing content stays in data/*.json.
const CRM_STORE_API_URL = (process.env.CRM_STORE_API_URL || '').replace(/\/+$/, '')

const money = (cents: any, currency = 'usd') => {
  const n = (Number(cents) || 0) / 100
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: String(currency || 'usd').toUpperCase() }).format(n)
  } catch { return '$' + n.toFixed(2) }
}

// Server-side read of the crm-store public API. Returns null on any failure so
// pages still render (empty) instead of 500-ing.
async function fetchStore(pathname: string): Promise<any> {
  if (!CRM_STORE_API_URL) return null
  try {
    const res = await fetch(CRM_STORE_API_URL + pathname, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return null
    return await res.json()
  } catch { return null }
}

// Loads image-meta.json once per call. Used by both wrapImagesWithPicture
// (post-render <img> rewrite) and bgWithWebp (EJS-time CSS background).
function loadImageMeta(): Record<string, { hasWebp?: boolean; width?: number; height?: number }> {
  try {
    const metaFile = path.join(appPaths.data, 'image-meta.json')
    if (fs.existsSync(metaFile)) return JSON.parse(fs.readFileSync(metaFile, 'utf8'))
  } catch {}
  return {}
}

// CSS-background image-set helper (Claflin 3.9). Use in EJS as:
//   style="background-image: <%- bgWithWebp(getImageUrl(hero.image)) %>"
function bgWithWebp(imgUrl: string): string {
  if (!imgUrl || typeof imgUrl !== 'string') return ''
  const m = imgUrl.match(/^\/uploads\/([^?#]+\.(?:jpe?g|png))$/i)
  if (!m) return `url('${imgUrl}')`
  const filename = m[1]
  const meta = loadImageMeta()[filename]
  if (!meta?.hasWebp) return `url('${imgUrl}')`
  const webpUrl = imgUrl.replace(/\.(jpe?g|png)$/i, '.webp')
  const sourceType = /\.png$/i.test(imgUrl) ? 'image/png' : 'image/jpeg'
  return `image-set(url('${webpUrl}') type('image/webp'), url('${imgUrl}') type('${sourceType}'))`
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
      if (meta.width && meta.height && !/\bwidth=/i.test(attrs)) {
        newAttrs = ` width="${meta.width}" height="${meta.height}"${attrs}`
      }
      let imgTag = `<img${newAttrs}>`
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
  const shared = { settings, menuItems, BASE_URL, hasVisualizer, hasEstimator, _jsonStr, _plainDesc, bgWithWebp, money, ...locals }
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

app.get('/', async (c) => {
  const homepage = loadJSON('homepage.json') || {}
  const services = loadJSON('services.json') || []
  const testimonials = loadJSON('testimonials.json') || []
  const settings = loadJSON('settings.json') || {}
  // Featured products for the home page (falls back to newest active if none flagged).
  const storeData = await fetchStore('/api/public/products')
  const allProducts = (storeData && Array.isArray(storeData.products)) ? storeData.products : []
  const featured = allProducts.filter((p: any) => p.featured)
  const products = (featured.length ? featured : allProducts).slice(0, 8)
  return renderPage(c, 'home', {
    homepage, services, testimonials, products,
    title: settings.seoTitle || settings.companyName || '{{COMPANY_NAME}}',
    description: settings.seoDescription || 'Shop {{COMPANY_NAME}}',
    canonicalUrl: BASE_URL + '/',
  })
})

// A store has no "services" pages — redirect any legacy /services link to the shop.
app.get('/services', (c) => c.redirect('/shop', 301))
app.get('/services/:slug', (c) => c.redirect('/shop', 301))

app.get('/about', (c) => {
  return renderPage(c, 'about', {
    title: 'About Us | {{COMPANY_NAME}}',
    description: 'Learn about {{COMPANY_NAME}} — serving {{SERVICE_REGION}} with quality craftsmanship.',
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
    description: 'News, tips, and updates.',
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
// STORE / COMMERCE
// ===========================================

app.get('/shop', async (c) => {
  const data = await fetchStore('/api/public/products')
  const products = (data && Array.isArray(data.products)) ? data.products : []
  return renderPage(c, 'shop', {
    products,
    title: 'Shop | {{COMPANY_NAME}}',
    description: 'Browse products from {{COMPANY_NAME}}.',
    canonicalUrl: BASE_URL + '/shop',
  })
})

app.get('/product/:slug', async (c) => {
  const slug = c.req.param('slug')
  const data = await fetchStore('/api/public/products/' + encodeURIComponent(slug))
  const product = data && data.product ? data.product : null
  if (!product) {
    return renderPage(c, '404', {
      title: 'Product not found | {{COMPANY_NAME}}',
      description: '', canonicalUrl: BASE_URL + '/shop',
    }, 404)
  }
  return renderPage(c, 'product', {
    product,
    title: (product.seoTitle || product.name) + ' | {{COMPANY_NAME}}',
    description: product.seoDescription || product.tagline || product.name,
    canonicalUrl: BASE_URL + '/product/' + product.slug,
  })
})

app.get('/cart', (c) => renderPage(c, 'cart', {
  title: 'Your Cart | {{COMPANY_NAME}}',
  description: 'Review the items in your cart.',
  canonicalUrl: BASE_URL + '/cart',
}))

// Thin proxy to the crm-store hosted-checkout endpoint. Keeps the crm-store API
// URL server-side and the browser same-origin.
app.post('/api/checkout', async (c) => {
  if (!CRM_STORE_API_URL) return c.json({ error: 'Checkout is not available yet.' }, 503)
  let body: any = null
  try { body = await c.req.json() } catch { return c.json({ error: 'Invalid request' }, 400) }
  // Tell crm-store the exact origin the customer is on so the post-checkout
  // redirect returns to the live storefront (not a not-yet-live custom domain).
  try {
    const host = c.req.header('x-forwarded-host') || c.req.header('host')
    const proto = (c.req.header('x-forwarded-proto') || 'https').split(',')[0]
    const origin = host ? `${proto}://${host}` : (BASE_URL || '')
    if (body && typeof body === 'object' && origin) body.origin = origin
  } catch {}
  try {
    const res = await fetch(CRM_STORE_API_URL + '/api/public/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return c.json({ error: data?.error || 'Checkout failed' }, (res.status as any) || 502)
    if (!data?.url) return c.json({ error: 'Checkout did not return a URL' }, 502)
    return c.json({ url: data.url })
  } catch {
    return c.json({ error: 'Could not reach the checkout service.' }, 502)
  }
})

app.get('/checkout/success', async (c) => {
  const sessionId = c.req.query('session_id') || ''
  let order = null
  if (sessionId) {
    const data = await fetchStore('/api/public/order-summary?session_id=' + encodeURIComponent(sessionId))
    order = data && data.order ? data.order : null
  }
  return renderPage(c, 'checkout-success', {
    order,
    title: 'Order Confirmed | {{COMPANY_NAME}}',
    description: 'Thank you for your order.',
    canonicalUrl: BASE_URL + '/checkout/success',
  })
})

// ===========================================
// VISION APP REDIRECT
// ===========================================

const visualizePage = path.join(__dirname, 'views', 'visualize.html')
// Exterior Visualizer is a paid add-on. VISION_URL is injected at deploy ONLY when the
// tenant has the visualizer feature, so /visualize stays OFF (redirects home) otherwise.
const VISION_URL = process.env.VISION_URL || ''
if (!VISION_URL) {
  app.get('/visualize', (c) => c.redirect('/', 302))
} else if (fs.existsSync(visualizePage)) {
  app.get('/visualize', (c) => c.html(fs.readFileSync(visualizePage, 'utf8').split('https://home-visualizer.onrender.com').join(VISION_URL)))
} else {
  app.get('/visualize', (c) => c.redirect(VISION_URL, 302))
  app.get('/visualize/*', (c) => {
    const sub = c.req.path.replace('/visualize', '')
    return c.redirect(VISION_URL + sub, 302)
  })
}

// ===========================================
// ESTIMATOR
// ===========================================

const CRM_API_URL = process.env.CRM_API_URL || ''
const TENANT_SLUG = process.env.TENANT_SLUG || '{{COMPANY_SLUG}}'

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
  // One-shot persistent-disk migrations (3.11) — flag-file-gated so they
  // only fire on first boot after a deploy that adds them. Deferred so a
  // slow migration doesn't delay the health check.
  setTimeout(() => { runMigrations() }, 5000)
})
