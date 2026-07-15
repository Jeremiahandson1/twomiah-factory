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
import logger from './services/logger.ts'

import authRoutes from './routes/auth.ts'
import publicRoutes from './routes/public.ts'
import productAdminRoutes from './routes/products.ts'
import orderAdminRoutes from './routes/orders.ts'
import settingsAdminRoutes from './routes/settings.ts'
import paymentAdminRoutes from './routes/payments.ts'

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

const PORT = Number(process.env.PORT) || 3001
serve({ fetch: app.fetch, port: PORT }, (info) => {
  logger.info(`crm-store running on port ${info.port}`, { env: process.env.NODE_ENV || 'development', port: info.port })
})

const shutdown = (signal: string) => { logger.info(`${signal} received, shutting down`); process.exit(0) }
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

export { app, db }
