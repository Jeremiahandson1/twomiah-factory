import { Hono } from 'hono'
import type { Context, Next } from 'hono'
import { cors } from 'hono/cors'
import { secureHeaders } from 'hono/secure-headers'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { db } from '../db/index.ts'
import { company } from '../db/schema.ts'
import { eq } from 'drizzle-orm'
import logger from './services/logger.ts'
import { initializeSocket, io } from './services/socket.ts'
import { errorHandler, handleUncaughtExceptions } from './utils/errors.ts'
import { syncFeatures } from './startup/featureSync.ts'
import { startReviewProcessor } from './services/reviews.ts'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const FRONTEND_DIST = path.resolve(__dirname, '..', 'frontend-dist')

import authRoutes from './routes/auth.ts'
import contactsRoutes from './routes/contacts.ts'
import projectsRoutes from './routes/projects.ts'
import jobsRoutes from './routes/jobs.ts'
import quotesRoutes from './routes/quotes.ts'
import invoicesRoutes from './routes/invoices.ts'
import timeRoutes from './routes/time.ts'
import expensesRoutes from './routes/expenses.ts'
import rfisRoutes from './routes/rfis.ts'
import changeOrdersRoutes from './routes/changeOrders.ts'
import punchListsRoutes from './routes/punchLists.ts'
import dailyLogsRoutes from './routes/dailyLogs.ts'
import inspectionsRoutes from './routes/inspections.ts'
import bidsRoutes from './routes/bids.ts'
import teamRoutes from './routes/team.ts'
import companyRoutes from './routes/company.ts'
import dashboardRoutes from './routes/dashboard.ts'
import documentsRoutes from './routes/documents.ts'
import billingRoutes from './routes/billing.ts'
import integrationsRoutes from './routes/integrations.ts'
import agencyAdminRoutes from './routes/agencyAdmin.ts'
import agreementsRoutes from './routes/agreements.ts'
import auditRoutes from './routes/audit.ts'
import bookingRoutes from './routes/booking.ts'
import bulkRoutes from './routes/bulk.ts'
import calltrackingRoutes from './routes/calltracking.ts'
import commentsRoutes from './routes/comments.ts'
import equipmentRoutes from './routes/equipment.ts'
import exportRoutes from './routes/export.ts'
import fleetRoutes from './routes/fleet.ts'
import gapFeaturesRoutes from './routes/gapFeatures.ts'
import geofencingRoutes from './routes/geofencing.ts'
import importRoutes from './routes/import.ts'
import migrationRoutes from './routes/migration.ts'
import inventoryRoutes from './routes/inventory.ts'
import mapsRoutes from './routes/maps.ts'
import marketingRoutes from './routes/marketing.ts'
import payrollRoutes from './routes/payroll.ts'
import photosRoutes from './routes/photos.ts'
import portalRoutes from './routes/portal.ts'
// portal-selections and portal-messages are handled inline in portal.ts under /p/:token/
import pricebookRoutes from './routes/pricebook.ts'
import pushRoutes from './routes/push.ts'
import quickbooksRoutes from './routes/quickbooks.ts'
import recurringRoutes from './routes/recurring.ts'
import reportingRoutes from './routes/reporting.ts'
import reviewsRoutes from './routes/reviews.ts'
import routingRoutes from './routes/routing.ts'
import schedulingRoutes from './routes/scheduling.ts'
import searchRoutes from './routes/search.ts'
import selectionsRoutes from './routes/selections.ts'
import smsRoutes from './routes/sms.ts'
import stripeRoutes from './routes/stripe.ts'
import takeoffsRoutes from './routes/takeoffs.ts'
import tasksRoutes from './routes/tasks.ts'
import timeTrackingRoutes from './routes/timeTracking.ts'
import warrantiesRoutes from './routes/warranties.ts'
import weatherRoutes from './routes/weather.ts'
import supportRoutes from './routes/support.ts'
import adsRoutes from './routes/ads.ts'
import leadsRoutes from './routes/leads.ts'
import wisetackRoutes from './routes/wisetack.ts'
import aiReceptionistRoutes from './routes/aiReceptionist.ts'
let webhooksRoutes: any = null
try { webhooksRoutes = (await import('./routes/webhooks.ts')).default } catch {}

handleUncaughtExceptions()

const app = new Hono()

app.use('*', secureHeaders({
  crossOriginResourcePolicy: 'cross-origin',
}))

// CORS — allow all origins; auth is handled by JWT, not origin checks
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'X-Request-ID'],
}))

function createRateLimiter(windowMs: number, max: number) {
  const hits = new Map<string, { count: number; resetAt: number }>()
  return async (c: Context, next: Next) => {
    const key = c.req.header('x-forwarded-for') || 'unknown'
    const now = Date.now()
    const entry = hits.get(key)
    if (!entry || now > entry.resetAt) {
      hits.set(key, { count: 1, resetAt: now + windowMs })
    } else {
      entry.count++
      if (entry.count > max) {
        return c.json({ error: 'Too many requests, please try again later' }, 429)
      }
    }
    await next()
  }
}

app.use('/api/*', createRateLimiter(15 * 60 * 1000, process.env.NODE_ENV === 'production' ? 100 : 1000))
app.use('/api/auth/login', createRateLimiter(15 * 60 * 1000, 20))
app.use('/api/auth/register', createRateLimiter(15 * 60 * 1000, 20))
app.use('/api/auth/forgot-password', createRateLimiter(15 * 60 * 1000, 20))

app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString(), uptime: process.uptime() }))

// API routes
if (webhooksRoutes) app.route('/api/webhooks', webhooksRoutes)
app.route('/api/auth', authRoutes)
app.route('/api/contacts', contactsRoutes)
app.route('/api/projects', projectsRoutes)
app.route('/api/jobs', jobsRoutes)
app.route('/api/quotes', quotesRoutes)
app.route('/api/invoices', invoicesRoutes)
app.route('/api/time', timeRoutes)
app.route('/api/expenses', expensesRoutes)
app.route('/api/rfis', rfisRoutes)
app.route('/api/change-orders', changeOrdersRoutes)
app.route('/api/punch-lists', punchListsRoutes)
app.route('/api/daily-logs', dailyLogsRoutes)
app.route('/api/inspections', inspectionsRoutes)
app.route('/api/bids', bidsRoutes)
app.route('/api/team', teamRoutes)
app.route('/api/company', companyRoutes)
app.route('/api/dashboard', dashboardRoutes)
app.route('/api/documents', documentsRoutes)
app.route('/api/billing', billingRoutes)
app.route('/api/integrations', integrationsRoutes)
app.route('/api/agency', agencyAdminRoutes)
app.route('/api/agreements', agreementsRoutes)
app.route('/api/audit', auditRoutes)
app.route('/api/booking', bookingRoutes)
app.route('/api/bulk', bulkRoutes)
app.route('/api/calltracking', calltrackingRoutes)
app.route('/api/comments', commentsRoutes)
app.route('/api/equipment', equipmentRoutes)
app.route('/api/export', exportRoutes)
app.route('/api/fleet', fleetRoutes)
app.route('/api/gap-features', gapFeaturesRoutes)
app.route('/api/geofencing', geofencingRoutes)
app.route('/api/import', importRoutes)
app.route('/api/migration', migrationRoutes)
app.route('/api/inventory', inventoryRoutes)
app.route('/api/maps', mapsRoutes)
app.route('/api/marketing', marketingRoutes)
app.route('/api/payroll', payrollRoutes)
app.route('/api/photos', photosRoutes)
app.route('/api/portal', portalRoutes)
app.route('/api/pricebook', pricebookRoutes)
app.route('/api/push', pushRoutes)
app.route('/api/quickbooks', quickbooksRoutes)
app.route('/api/recurring', recurringRoutes)
app.route('/api/reports', reportingRoutes)
app.route('/api/reviews', reviewsRoutes)
app.route('/api/routing', routingRoutes)
app.route('/api/scheduling', schedulingRoutes)
app.route('/api/search', searchRoutes)
app.route('/api/selections', selectionsRoutes)
app.route('/api/sms', smsRoutes)
app.route('/api/stripe', stripeRoutes)
app.route('/api/takeoffs', takeoffsRoutes)
app.route('/api/tasks', tasksRoutes)
app.route('/api/time-tracking', timeTrackingRoutes)
app.route('/api/warranties', warrantiesRoutes)
app.route('/api/weather', weatherRoutes)
app.route('/api/support', supportRoutes)
app.route('/api/ads', adsRoutes)
app.route('/api/leads', leadsRoutes)
app.route('/api/wisetack', wisetackRoutes)
app.route('/api/ai-receptionist', aiReceptionistRoutes)

// Factory sync endpoint — allows Twomiah Factory to push feature updates via HTTP
// Secured by a shared secret (FACTORY_SYNC_KEY env var)
app.post('/api/internal/sync-features', async (c) => {
  const syncKey = process.env.FACTORY_SYNC_KEY
  if (!syncKey) return c.json({ error: 'Sync not configured' }, 503)
  const authHeader = c.req.header('X-Factory-Key')
  if (authHeader !== syncKey) return c.json({ error: 'Unauthorized' }, 401)
  const { features } = await c.req.json()
  if (!Array.isArray(features)) return c.json({ error: 'features must be an array' }, 400)
  const [comp] = await db.select().from(company).limit(1)
  if (!comp) return c.json({ error: 'No company found' }, 404)
  const [updated] = await db.update(company).set({ enabledFeatures: features, updatedAt: new Date() }).where(eq(company.id, comp.id)).returning()
  return c.json({ success: true, features: updated.enabledFeatures })
})

app.onError(errorHandler)

// MIME type map for Bun runtime (serveStatic sometimes serves as text/plain)
const MIME_TYPES: Record<string, string> = {
  '.css': 'text/css', '.js': 'application/javascript', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.html': 'text/html',
}

// ─── Serve frontend SPA from backend (no separate static site needed) ────────
const hasFrontendBuild = fs.existsSync(path.join(FRONTEND_DIST, 'index.html'))
if (hasFrontendBuild) {
  // Serve static frontend assets with correct MIME types
  app.use('*', async (c, next) => {
    if (c.req.path.startsWith('/api/')) return next()
    const filePath = path.join(FRONTEND_DIST, c.req.path)
    try {
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const ext = path.extname(filePath).toLowerCase()
        const mime = MIME_TYPES[ext] || 'application/octet-stream'
        const body = fs.readFileSync(filePath)
        return c.body(body, 200, { 'Content-Type': mime, 'Cache-Control': 'public, max-age=86400' })
      }
    } catch {}
    return next()
  })

  // SPA fallback: serve index.html for all non-API GET requests
  const indexHtml = fs.readFileSync(path.join(FRONTEND_DIST, 'index.html'), 'utf8')

  // Register known SPA route prefixes explicitly before the catch-all
  // so they are matched deterministically and never fall through to notFound
  app.get('/admin/*', (c) => c.html(indexHtml))
  app.get('/crm/*', (c) => c.html(indexHtml))
  app.get('/login', (c) => c.html(indexHtml))
  app.get('/register', (c) => c.html(indexHtml))
  app.get('*', (c) => c.html(indexHtml))

  // Catch any non-GET requests to SPA routes that slip through
  app.notFound((c) => {
    if (c.req.method === 'GET') return c.html(indexHtml)
    return c.json({ error: `Route not found: ${c.req.method} ${c.req.path}` }, 404)
  })

  logger.info('Serving frontend from ' + FRONTEND_DIST)
} else {
  app.notFound((c) => c.json({ error: `Route not found: ${c.req.method} ${c.req.path}` }, 404))
}

const PORT = Number(process.env.PORT) || 3001

const server = serve({ fetch: app.fetch, port: PORT }, (info) => {
  logger.info(`Server running on port ${info.port}`, {
    env: process.env.NODE_ENV || 'development',
    port: info.port,
    websocket: 'enabled',
  })
})

initializeSocket(server as any)
syncFeatures().catch(console.error)
startReviewProcessor()

const shutdown = async (signal: string) => {
  logger.info(`${signal} received, shutting down gracefully`)
  process.exit(0)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

export { app, db, io }
