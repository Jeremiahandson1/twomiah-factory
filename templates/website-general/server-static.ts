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
  app.use('/admin/*', serveStatic({ root: path.relative(process.cwd(), adminDist), rewriteRequestPath: (p) => p.replace('/admin', '') }))
  app.get('/admin*', async (c) => {
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

const hasVisualizer = fs.existsSync(path.join(__dirname, 'views', 'visualize.html')) || !!(process.env.VISION_URL)
const hasEstimator = process.env.HAS_ESTIMATOR === 'true'

function renderPage(c: any, pageView: string, locals: Record<string, any> = {}, statusCode = 200) {
  const settings = loadJSON('settings.json') || {}
  const navConfig = loadJSON('nav-config.json') || {}
  const menuItems = Array.isArray(navConfig.items) ? navConfig.items : Array.isArray(navConfig) ? navConfig : []
  const shared = { settings, menuItems, BASE_URL, hasVisualizer, hasEstimator, ...locals }
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
    description: settings.seoDescription || 'Professional services',
    canonicalUrl: BASE_URL + '/',
  })
})

app.get('/services/:slug', (c) => {
  const slug = c.req.param('slug')
  const services = loadJSON('services.json') || []
  let service = services.find((s: any) => s.slug === slug)
  if (!service) {
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
// VISION APP REDIRECT
// ===========================================

const visualizePage = path.join(__dirname, 'views', 'visualize.html')
if (fs.existsSync(visualizePage)) {
  app.get('/visualize', (c) => {
    const html = fs.readFileSync(visualizePage, 'utf8')
    return c.html(html)
  })
} else {
  const VISION_URL = process.env.VISION_URL || ''
  if (VISION_URL) {
    app.get('/visualize', (c) => c.redirect(VISION_URL, 302))
    app.get('/visualize/*', (c) => {
      const sub = c.req.path.replace('/visualize', '')
      return c.redirect(VISION_URL + sub, 302)
    })
  }
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
})
