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
import { orders } from '../db/schema.ts'
import { and, eq, lt } from 'drizzle-orm'
import logger from './services/logger.ts'

import authRoutes from './routes/auth.ts'
import publicRoutes from './routes/public.ts'
import productAdminRoutes from './routes/products.ts'
import orderAdminRoutes from './routes/orders.ts'
import settingsAdminRoutes from './routes/settings.ts'
import paymentAdminRoutes from './routes/payments.ts'
import emailAliasesRoutes from './routes/emailAliases.ts'
import companyShimRoutes from './routes/company.ts'
import onboardingRoutes from './routes/onboarding.ts'
import supplierRoutes from './suppliers/routes.ts'
import inboundParseRoutes from './routes/inboundParse.ts'
import inboundMessagesRoutes from './routes/inboundMessages.ts'
import discountAdminRoutes from './routes/discounts.ts'
import reviewAdminRoutes from './routes/reviews.ts'
import shippingAdminRoutes from './routes/shipping.ts'
import mediaRoutes from './routes/media.ts'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const FRONTEND_DIST = path.resolve(__dirname, '..', 'frontend-dist')

const app = new Hono()

app.use('*', secureHeaders({ crossOriginResourcePolicy: 'cross-origin' }))

// CORS — the public catalog + checkout are called from the separate storefront
// origin. Auth for admin is JWT (Bearer), not cookies, so a permissive origin is
// safe: no credentials ride along, prices are server-trusted, webhooks are
// signature-verified, and admin routes require a valid token regardless.
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
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
      if (entry.count > max) return c.json({ error: 'Too many requests, please try again later' }, 429)
    }
    await next()
  }
}

const isProd = process.env.NODE_ENV === 'production'
// Webhooks are excluded from rate limiting (signature-verified, provider-driven).
app.use('/api/public/products/*', createRateLimiter(15 * 60 * 1000, isProd ? 600 : 5000))
app.use('/api/public/checkout', createRateLimiter(15 * 60 * 1000, isProd ? 60 : 1000))
app.use('/api/admin/*', createRateLimiter(15 * 60 * 1000, isProd ? 300 : 5000))
app.use('/api/auth/login', createRateLimiter(15 * 60 * 1000, 20))

app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString(), uptime: process.uptime() }))

// Public storefront API (catalog reads, checkout, webhook, order summary).
app.route('/api/public', publicRoutes)
// Auth + tenant admin API.
app.route('/api/auth', authRoutes)
app.route('/api/admin/products', productAdminRoutes)
app.route('/api/admin/orders', orderAdminRoutes)
app.route('/api/admin/settings', settingsAdminRoutes)
app.route('/api/admin/payments', paymentAdminRoutes)
app.route('/api/email-aliases', emailAliasesRoutes)
app.route('/api/company', companyShimRoutes)
app.route('/api/onboarding', onboardingRoutes)
app.route('/api/admin/suppliers', supplierRoutes)
app.route('/api/internal/inbound-email', inboundParseRoutes)
app.route('/api/inbound-messages', inboundMessagesRoutes)
app.route('/api/admin/discounts', discountAdminRoutes)
app.route('/api/admin/reviews', reviewAdminRoutes)
app.route('/api/admin/shipping', shippingAdminRoutes)
// Public media proxy for product images (streamed from private R2). Must be
// registered before the SPA catch-all below so `/media/*` is not swallowed.
app.route('/media', mediaRoutes)

app.onError((err, c) => {
  logger.error('unhandled error', { error: err?.message, path: c.req.path })
  return c.json({ error: 'Internal server error' }, 500)
})

// ─── Serve the admin SPA from this backend (single service) ──────────────────
const hasFrontendBuild = fs.existsSync(path.join(FRONTEND_DIST, 'index.html'))
if (hasFrontendBuild) {
  const relRoot = path.relative(process.cwd(), FRONTEND_DIST)
  app.use('/assets/*', serveStatic({ root: relRoot }))
  app.use('/favicon.ico', serveStatic({ root: relRoot }))
  app.use('/favicon.png', serveStatic({ root: relRoot }))
  const indexHtml = fs.readFileSync(path.join(FRONTEND_DIST, 'index.html'), 'utf8')
  app.get('*', (c) => c.html(indexHtml))
  logger.info('Serving admin SPA from ' + FRONTEND_DIST)
} else {
  app.notFound((c) => c.json({ error: `Route not found: ${c.req.method} ${c.req.path}` }, 404))
}

// Stale-cart sweep: checkouts that were started but never paid linger as
// 'pending'. Cancel any older than 24h so the orders list + revenue stats stay
// clean. Runs hourly (and once at boot). Non-blocking.
// 7 days: the abandoned-cart reminder needs room to work before a pending
// order is written off (it used to be cancelled after 24h, unrecovered).
const STALE_PENDING_MS = 7 * 24 * 60 * 60 * 1000
async function sweepStalePending(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - STALE_PENDING_MS)
    await db.update(orders)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(and(eq(orders.status, 'pending'), lt(orders.createdAt, cutoff)))
  } catch (e: any) {
    logger.warn('stale-cart sweep failed', { error: e?.message })
  }
}
setInterval(() => { void sweepStalePending() }, 60 * 60 * 1000)
void sweepStalePending()

// Abandoned carts: remind once, then let the sweep above age them out. Before
// this, every abandoned cart was cancelled silently and never followed up.
import('./services/abandonedCart.ts').then((m) => {
  setInterval(() => { void m.sweepAbandonedCarts() }, 30 * 60 * 1000)
  setTimeout(() => { void m.sweepAbandonedCarts() }, 60_000)
}).catch(() => { /* recovery module unavailable — store still runs */ })

// Ask for a review once, a few days after an order ships.
import('./services/reviews.ts').then((m) => {
  setInterval(() => { void m.sweepReviewRequests() }, 6 * 60 * 60 * 1000)
  setTimeout(() => { void m.sweepReviewRequests() }, 120_000)
}).catch(() => { /* reviews module unavailable — store still runs */ })

// Dropship: retry un-forwarded paid orders + poll tracking for providers
// without webhooks. Same cadence as the stale-pending sweep.
import('./suppliers/index.ts').then(m => {
  setInterval(() => { void m.sweepSupplierOrders() }, 60 * 60 * 1000)
  void m.sweepSupplierOrders()
}).catch(() => { /* suppliers module unavailable — store runs without dropship */ })

const PORT = Number(process.env.PORT) || 3001
serve({ fetch: app.fetch, port: PORT }, (info) => {
  logger.info(`crm-store running on port ${info.port}`, { env: process.env.NODE_ENV || 'development', port: info.port })
})

const shutdown = (signal: string) => { logger.info(`${signal} received, shutting down`); process.exit(0) }
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

export { app, db }
