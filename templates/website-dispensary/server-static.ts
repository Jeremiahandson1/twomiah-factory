import { Hono } from 'hono'
import { secureHeaders } from 'hono/secure-headers'
import { cors } from 'hono/cors'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { getCookie, setCookie } from 'hono/cookie'
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

// Rate limiting
const rateLimitMap = new Map<string, { count: number; resetAt: number }>()
const contactLimitMap = new Map<string, { count: number; resetAt: number }>()
const loyaltyLimitMap = new Map<string, { count: number; resetAt: number }>()

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
// AGE GATE MIDDLEWARE
// ===========================================

const AGE_GATED_PATHS = ['/menu', '/order', '/merch', '/loyalty']

app.use('*', async (c, next) => {
  const reqPath = new URL(c.req.url).pathname
  const needsGate = AGE_GATED_PATHS.some(p => reqPath === p || reqPath.startsWith(p + '/'))
  if (needsGate) {
    const verified = getCookie(c, 'age_verified')
    if (!verified) {
      return c.redirect('/age-verify?next=' + encodeURIComponent(reqPath), 302)
    }
  }
  return next()
})

// ===========================================
// API ROUTES
// ===========================================

app.get('/api/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() })
})

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

const CRM_API_URL = process.env.CRM_API_URL || ''
const TENANT_SLUG = process.env.TENANT_SLUG || '{{COMPANY_SLUG}}'

function renderPage(c: any, pageView: string, locals: Record<string, any> = {}, statusCode = 200) {
  const settings = loadJSON('settings.json') || {}
  const navConfig = loadJSON('nav-config.json') || {}
  const menuItems = Array.isArray(navConfig.items) ? navConfig.items : Array.isArray(navConfig) ? navConfig : []
  const shared = { settings, menuItems, BASE_URL, CRM_API_URL, ...locals }
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
        resolve(c.html(html, statusCode))
      })
    })
  })
}

// Standalone page render (no layout — for age gate)
function renderStandalone(c: any, pageView: string, locals: Record<string, any> = {}, statusCode = 200) {
  const settings = loadJSON('settings.json') || {}
  const pageFile = path.join(__dirname, 'views', pageView + '.ejs')
  const shared = { settings, BASE_URL, ...locals }

  return new Promise<Response>((resolve) => {
    ejs.renderFile(pageFile, shared, (err: any, html: string) => {
      if (err) {
        console.error('EJS render error:', err.message)
        resolve(c.text('Render error', 500))
        return
      }
      resolve(c.html(html, statusCode))
    })
  })
}

// ===========================================
// MENU CACHE
// ===========================================

let menuCache: { data: any; expiresAt: number } | null = null
const MENU_CACHE_TTL = 60_000 // 60 seconds

async function fetchMenu() {
  if (menuCache && Date.now() < menuCache.expiresAt) {
    return menuCache.data
  }
  if (!CRM_API_URL) return []
  try {
    const res = await fetch(`${CRM_API_URL}/api/public/menu`)
    if (!res.ok) throw new Error(`Menu API ${res.status}`)
    const data = await res.json()
    menuCache = { data, expiresAt: Date.now() + MENU_CACHE_TTL }
    return data
  } catch (err) {
    console.error('Failed to fetch menu:', err)
    return menuCache?.data || []
  }
}

// ===========================================
// AGE GATE ROUTES
// ===========================================

app.get('/age-verify', (c) => {
  const settings = loadJSON('settings.json') || {}
  const logoUrl = settings?.logo
    ? (settings.logo.startsWith('http') ? settings.logo : (settings.logo.startsWith('/') ? settings.logo : '/' + settings.logo))
    : '/uploads/logo.png'
  const next = c.req.query('next') || '/'
  return renderStandalone(c, 'age-gate', { logoUrl, next })
})

app.post('/age-verify', async (c) => {
  const body = await c.req.parseBody()
  const next = (body.next as string) || '/'
  setCookie(c, 'age_verified', '1', {
    path: '/',
    maxAge: 86400, // 24 hours
    httpOnly: false,
    sameSite: 'Lax',
  })
  return c.redirect(next, 302)
})

// ===========================================
// PAGE ROUTES
// ===========================================

app.get('/', (c) => {
  const homepage = loadJSON('homepage.json') || {}
  const services = loadJSON('services.json') || []
  const testimonials = loadJSON('testimonials.json') || []
  const settings = loadJSON('settings.json') || {}
  return renderPage(c, 'home', {
    homepage, services, testimonials,
    title: settings.seoTitle || settings.companyName || '{{COMPANY_NAME}}',
    description: settings.seoDescription || 'Premium cannabis dispensary',
    canonicalUrl: BASE_URL + '/',
  })
})

app.get('/menu', async (c) => {
  const products = await fetchMenu()
  return renderPage(c, 'menu', {
    products,
    title: 'Menu | {{COMPANY_NAME}}',
    description: 'Browse our full cannabis menu — flower, edibles, concentrates, vapes, pre-rolls, and more.',
    canonicalUrl: BASE_URL + '/menu',
  })
})

app.get('/order', async (c) => {
  const products = await fetchMenu()
  return renderPage(c, 'order', {
    products,
    title: 'Order Online | {{COMPANY_NAME}}',
    description: 'Order cannabis online for pickup or delivery. Browse our full menu and place your order.',
    canonicalUrl: BASE_URL + '/order',
  })
})

// Public order submission proxy (rate limited)
app.use('/api/order', rateLimit(contactLimitMap, 10, 15 * 60 * 1000))
app.post('/api/order', async (c) => {
  if (!CRM_API_URL) return c.json({ success: false, message: 'Ordering not available' }, 503)
  try {
    const body = await c.req.json()
    const res = await fetch(`${CRM_API_URL}/api/public/menu/order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-company-slug': TENANT_SLUG },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    return c.json(data, res.status as any)
  } catch (err) {
    console.error('Order submission error:', err)
    return c.json({ success: false, message: 'Unable to submit order right now' }, 500)
  }
})

app.get('/loyalty', (c) => {
  return renderPage(c, 'loyalty', {
    title: 'Loyalty Program | {{COMPANY_NAME}}',
    description: 'Earn points on every purchase and redeem for discounts. Join our loyalty program today.',
    canonicalUrl: BASE_URL + '/loyalty',
  })
})

// Loyalty points check proxy (rate limited)
app.use('/api/loyalty/check', rateLimit(loyaltyLimitMap, 5, 15 * 60 * 1000))
app.post('/api/loyalty/check', async (c) => {
  if (!CRM_API_URL) return c.json({ success: false, message: 'Loyalty system not configured' }, 503)
  try {
    const body = await c.req.json()
    const res = await fetch(`${CRM_API_URL}/api/public/loyalty/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    return c.json(data, res.status as any)
  } catch (err) {
    console.error('Loyalty check error:', err)
    return c.json({ success: false, message: 'Unable to check points right now' }, 500)
  }
})

app.get('/about', (c) => {
  return renderPage(c, 'about', {
    title: 'About Us | {{COMPANY_NAME}}',
    description: 'Learn about {{COMPANY_NAME}} — serving {{SERVICE_REGION}}.',
    canonicalUrl: BASE_URL + '/about',
  })
})

app.get('/contact', (c) => {
  const services = loadJSON('services.json') || []
  return renderPage(c, 'contact', {
    services, selectedService: c.req.query('service') || '',
    title: 'Contact Us | {{COMPANY_NAME}}',
    description: 'Get in touch with our dispensary. Questions about products, hours, or placing an order.',
    canonicalUrl: BASE_URL + '/contact',
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

// API 404 — must be registered BEFORE the page catch-all
app.all('/api/*', (c) => {
  return c.json({ success: false, message: 'Endpoint not found' }, 404)
})

// Catch-all: render 404 for unmatched page requests
app.get('*', (c) => {
  return renderPage(c, '404', {
    title: 'Page Not Found | {{COMPANY_NAME}}',
    description: 'The page you are looking for could not be found.',
    canonicalUrl: BASE_URL + '/',
  }, 404)
})

// ===========================================
// ERROR HANDLING
// ===========================================

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
})
