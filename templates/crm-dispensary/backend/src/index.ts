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

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const FRONTEND_DIST = path.resolve(__dirname, '..', 'frontend-dist')

import authRoutes from './routes/auth.ts'
import contactsRoutes from './routes/contacts.ts'
import teamRoutes from './routes/team.ts'
import companyRoutes from './routes/company.ts'
import dashboardRoutes from './routes/dashboard.ts'
import documentsRoutes from './routes/documents.ts'
import exportRoutes from './routes/export.ts'
import importRoutes from './routes/import.ts'
import marketingRoutes from './routes/marketing.ts'
import photosRoutes from './routes/photos.ts'
import pushRoutes from './routes/push.ts'
import searchRoutes from './routes/search.ts'
import smsRoutes from './routes/sms.ts'
import stripeRoutes from './routes/stripe.ts'
import supportRoutes from './routes/support.ts'
import leadsRoutes from './routes/leads.ts'
import auditRoutes from './routes/audit.ts'

// Dispensary-specific routes
import productsRoutes from './routes/products.ts'
import ordersRoutes from './routes/orders.ts'
import loyaltyRoutes from './routes/loyalty.ts'
import deliveryRoutes from './routes/delivery.ts'
import menuRoutes from './routes/menu.ts'
import analyticsRoutes from './routes/analytics.ts'
import cashRoutes from './routes/cash.ts'
import integrationsRoutes from './routes/integrations.ts'

// New feature routes
import metrcRoutes from './routes/metrc.ts'
import labelsRoutes from './routes/labels.ts'
import complianceRoutes from './routes/compliance.ts'
import locationsRoutes from './routes/locations.ts'
import rfidRoutes from './routes/rfid.ts'
import batchesRoutes from './routes/batches.ts'
import trackingRoutes from './routes/tracking.ts'
import kioskRoutes from './routes/kiosk.ts'
import recommendationsRoutes from './routes/recommendations.ts'
import referralsRoutes from './routes/referrals.ts'
import reportsRoutes from './routes/reports.ts'
import cultivationRoutes from './routes/cultivation.ts'
import manufacturingRoutes from './routes/manufacturing.ts'
import wholesaleRoutes from './routes/wholesale.ts'
import websiteAnalyticsRoutes from './routes/website-analytics.ts'
import enterpriseRoutes from './routes/enterprise.ts'

// Phase 2 feature routes
import checkinRoutes from './routes/checkin.ts'
import idScannerRoutes from './routes/id-scanner.ts'
import biotrackRoutes from './routes/biotrack.ts'
import payByBankRoutes from './routes/pay-by-bank.ts'
import walletPassesRoutes from './routes/wallet-passes.ts'
import aiBudtenderRoutes from './routes/ai-budtender.ts'
import seoPagesRoutes from './routes/seo-pages.ts'
import predictiveInventoryRoutes from './routes/predictive-inventory.ts'
import gamifiedLoyaltyRoutes from './routes/gamified-loyalty.ts'
import signageRoutes from './routes/signage.ts'
import curbsideRoutes from './routes/curbside.ts'
import equivalencyRoutes from './routes/equivalency.ts'
import taxFilingRoutes from './routes/tax-filing.ts'
import marketplaceRoutes from './routes/marketplace.ts'
import platformRoutes from './routes/platform.ts'
import securityRoutes from './routes/security.ts'
import complianceControlsRoutes from './routes/compliance-controls.ts'
import growInputsRoutes from './routes/grow-inputs.ts'
import qrScannerRoutes from './routes/qr-scanner.ts'
import schedulingRoutes from './routes/scheduling.ts'
import trainingRoutes from './routes/training.ts'
import fraudDetectionRoutes from './routes/fraud-detection.ts'
import approvalsRoutes from './routes/approvals.ts'
import offlineRoutes from './routes/offline.ts'
import eodRoutes from './routes/eod.ts'
import purchaseOrdersRoutes from './routes/purchase-orders.ts'
import menuSyncRoutes from './routes/menu-sync.ts'
import leafDataRoutes from './routes/leaf-data.ts'
import emailAliasesRoutes from './routes/emailAliases.ts'
import emailDomainRoutes from './routes/emailDomain.ts'
import accountRoutes from './routes/account.ts'
import inboundParseRoutes from './routes/inboundParse.ts'
import inboundMessagesRoutes from './routes/inboundMessages.ts'
import onboardingRoutes from './routes/onboarding.ts'

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
  allowHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'X-Request-ID', 'X-Integration-Key'],
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
app.route('/api/team', teamRoutes)
app.route('/api/company', companyRoutes)
app.route('/api/email-aliases', emailAliasesRoutes)
app.route('/api/email-domain', emailDomainRoutes)
app.route('/api/account', accountRoutes)
app.route('/api/internal/inbound-email', inboundParseRoutes)
app.route('/api/inbound-messages', inboundMessagesRoutes)
app.route('/api/onboarding', onboardingRoutes)
app.route('/api/dashboard', dashboardRoutes)
app.route('/api/documents', documentsRoutes)
app.route('/api/export', exportRoutes)
app.route('/api/import', importRoutes)
app.route('/api/marketing', marketingRoutes)
app.route('/api/photos', photosRoutes)
app.route('/api/push', pushRoutes)
app.route('/api/search', searchRoutes)
app.route('/api/sms', smsRoutes)
app.route('/api/stripe', stripeRoutes)
app.route('/api/support', supportRoutes)
app.route('/api/leads', leadsRoutes)
app.route('/api/audit', auditRoutes)

// Dispensary-specific routes
app.route('/api/products', productsRoutes)
app.route('/api/orders', ordersRoutes)
app.route('/api/loyalty', loyaltyRoutes)
app.route('/api/delivery', deliveryRoutes)
app.route('/api/public/menu', menuRoutes)
app.route('/api/analytics', analyticsRoutes)
app.route('/api/cash', cashRoutes)
app.route('/api/integrations', integrationsRoutes)

// New feature routes
app.route('/api/metrc', metrcRoutes)
app.route('/api/labels', labelsRoutes)
app.route('/api/compliance', complianceRoutes)
app.route('/api/locations', locationsRoutes)
app.route('/api/rfid', rfidRoutes)
app.route('/api/batches', batchesRoutes)
app.route('/api/tracking', trackingRoutes)
app.route('/api/kiosk', kioskRoutes)
app.route('/api/recommendations', recommendationsRoutes)
app.route('/api/referrals', referralsRoutes)
app.route('/api/reports', reportsRoutes)
app.route('/api/cultivation', cultivationRoutes)
app.route('/api/manufacturing', manufacturingRoutes)
app.route('/api/wholesale', wholesaleRoutes)
app.route('/api/website-analytics', websiteAnalyticsRoutes)
app.route('/api/enterprise', enterpriseRoutes)

// Phase 2 feature routes
app.route('/api/checkin', checkinRoutes)
app.route('/api/id-scanner', idScannerRoutes)
app.route('/api/biotrack', biotrackRoutes)
app.route('/api/pay-by-bank', payByBankRoutes)
app.route('/api/wallet-passes', walletPassesRoutes)
app.route('/api/ai-budtender', aiBudtenderRoutes)
app.route('/api/seo-pages', seoPagesRoutes)
app.route('/api/predictive-inventory', predictiveInventoryRoutes)
app.route('/api/gamified-loyalty', gamifiedLoyaltyRoutes)
app.route('/api/signage', signageRoutes)
app.route('/api/curbside', curbsideRoutes)
app.route('/api/equivalency', equivalencyRoutes)
app.route('/api/tax-filing', taxFilingRoutes)
app.route('/api/marketplace', marketplaceRoutes)
app.route('/api/platform', platformRoutes)
app.route('/api/security', securityRoutes)
app.route('/api/compliance-controls', complianceControlsRoutes)
app.route('/api/grow-inputs', growInputsRoutes)
app.route('/api/qr-scanner', qrScannerRoutes)
app.route('/api/scheduling', schedulingRoutes)
app.route('/api/training', trainingRoutes)
app.route('/api/fraud-detection', fraudDetectionRoutes)
app.route('/api/approvals', approvalsRoutes)
app.route('/api/offline', offlineRoutes)
app.route('/api/eod', eodRoutes)
app.route('/api/purchase-orders', purchaseOrdersRoutes)
app.route('/api/menu-sync', menuSyncRoutes)
app.route('/api/leaf-data', leafDataRoutes)

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

const shutdown = async (signal: string) => {
  logger.info(`${signal} received, shutting down gracefully`)
  process.exit(0)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

export { app, db, io }
