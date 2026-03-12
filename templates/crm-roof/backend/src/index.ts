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

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const FRONTEND_DIST = path.resolve(__dirname, '..', 'frontend-dist')

import authRoutes from './routes/auth.ts'
import contactsRoutes from './routes/contacts.ts'
import jobsRoutes from './routes/jobs.ts'
import crewsRoutes from './routes/crews.ts'
import measurementsRoutes from './routes/measurements.ts'
import materialsRoutes from './routes/materials.ts'
import quotesRoutes from './routes/quotes.ts'
import invoicesRoutes from './routes/invoices.ts'
import smsRoutes from './routes/sms.ts'
import portalRoutes from './routes/portal.ts'
import estimatorRoutes from './routes/estimator.ts'
import settingsRoutes from './routes/settings.ts'
import insuranceRoutes from './routes/insurance.ts'
import canvassingRoutes from './routes/canvassing.ts'
import stormRoutes from './routes/storms.ts'
import quickbooksRoutes from './routes/quickbooks.ts'

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

// Rate limiter
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
app.use('/api/auth/signup', createRateLimiter(15 * 60 * 1000, 20))
app.use('/api/auth/forgot-password', createRateLimiter(15 * 60 * 1000, 20))

// Health check
app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString(), uptime: process.uptime() }))

// API routes
app.route('/api/auth', authRoutes)
app.route('/api/contacts', contactsRoutes)
app.route('/api/jobs', jobsRoutes)
app.route('/api/crews', crewsRoutes)
app.route('/api/measurements', measurementsRoutes)
app.route('/api/materials', materialsRoutes)
app.route('/api/quotes', quotesRoutes)
app.route('/api/invoices', invoicesRoutes)
app.route('/api/sms', smsRoutes)
app.route('/api/portal', portalRoutes)
app.route('/api/settings', settingsRoutes)
app.route('/api/insurance', insuranceRoutes)
app.route('/api/canvassing', canvassingRoutes)
app.route('/api/storms', stormRoutes)
app.route('/api/quickbooks', quickbooksRoutes)
app.route('/api/estimator', estimatorRoutes) // public — no auth

// Error handler
app.onError((err, c) => {
  logger.error('Unhandled error', { message: err.message, stack: err.stack, path: c.req.path, method: c.req.method })

  if (err.name === 'ZodError') {
    return c.json({ error: 'Validation error', details: (err as any).issues }, 400)
  }

  return c.json({ error: 'Internal server error' }, 500)
})

// Serve frontend SPA from backend
const hasFrontendBuild = fs.existsSync(path.join(FRONTEND_DIST, 'index.html'))
if (hasFrontendBuild) {
  const relRoot = path.relative(process.cwd(), FRONTEND_DIST)
  app.use('/assets/*', serveStatic({ root: relRoot }))
  app.use('/favicon.ico', serveStatic({ root: relRoot }))
  app.use('/favicon.png', serveStatic({ root: relRoot }))
  app.use('/logo.*', serveStatic({ root: relRoot }))
  app.use('/estimator.js', serveStatic({ root: relRoot }))

  // SPA fallback: serve index.html for all non-API GET requests
  const indexHtml = fs.readFileSync(path.join(FRONTEND_DIST, 'index.html'), 'utf8')
  app.get('*', (c) => c.html(indexHtml))
  logger.info('Serving frontend from ' + FRONTEND_DIST)
} else {
  app.notFound((c) => c.json({ error: `Route not found: ${c.req.method} ${c.req.path}` }, 404))
}

const PORT = Number(process.env.PORT) || 3001

const server = serve({ fetch: app.fetch, port: PORT }, (info) => {
  logger.info(`Server running on port ${info.port}`, {
    env: process.env.NODE_ENV || 'development',
    port: info.port,
  })
})

const shutdown = async (signal: string) => {
  logger.info(`${signal} received, shutting down gracefully`)
  process.exit(0)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

export { app, db }
