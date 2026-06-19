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
import { initializeSocket, io } from './services/socket.ts'
import { errorHandler, handleUncaughtExceptions } from './utils/errors.ts'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const FRONTEND_DIST = path.resolve(__dirname, '..', 'frontend-dist')

// Core routes
import authRoutes from './routes/auth.ts'
import contactsRoutes from './routes/contacts.ts'
import teamRoutes from './routes/team.ts'
import companyRoutes from './routes/company.ts'
import dashboardRoutes from './routes/dashboard.ts'
import auditRoutes from './routes/audit.ts'
import supportRoutes from './routes/support.ts'
import leadsRoutes from './routes/leads.ts'

// RV / powersports routes
import unitsRoutes from './routes/units.ts'
import salesLeadsRoutes from './routes/salesLeads.ts'
import repairOrdersRoutes from './routes/repairOrders.ts'
import alertsRoutes from './routes/alerts.ts'
import recallsRoutes from './routes/recalls.ts'
import reportingRoutes from './routes/reporting.ts'
import syndicationRoutes from './routes/syndication.ts'
import smsRoutes, { smsWebhook } from './routes/sms.ts'
import sequencesRoutes from './routes/sequences.ts'
import { startSequenceRunner } from './services/sequenceRunner.ts'

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

// Core API routes
app.route('/api/auth', authRoutes)
app.route('/api/contacts', contactsRoutes)
app.route('/api/team', teamRoutes)
app.route('/api/company', companyRoutes)
app.route('/api/dashboard', dashboardRoutes)
app.route('/api/audit', auditRoutes)
app.route('/api/support', supportRoutes)
app.route('/api/leads', leadsRoutes)

// RV / powersports API routes
app.route('/api/units', unitsRoutes)
app.route('/api/sales-leads', salesLeadsRoutes)
app.route('/api/repair-orders', repairOrdersRoutes)
app.route('/api/alerts', alertsRoutes)
app.route('/api/recalls', recallsRoutes)
app.route('/api/reporting', reportingRoutes)
app.route('/api/syndication', syndicationRoutes)
app.route('/api/sms', smsRoutes)
app.route('/api/sequences', sequencesRoutes)
// Inbound Twilio webhook — no auth (Twilio can't send a JWT); mounted at /api/webhooks/sms
app.route('/api/webhooks', smsWebhook)

app.onError(errorHandler)

// ─── Serve frontend SPA from backend (no separate static site needed) ────────
const hasFrontendBuild = fs.existsSync(path.join(FRONTEND_DIST, 'index.html'))
if (hasFrontendBuild) {
  const relRoot = path.relative(process.cwd(), FRONTEND_DIST)
  app.use('/assets/*', serveStatic({ root: relRoot }))
  app.use('/favicon.ico', serveStatic({ root: relRoot }))
  app.use('/favicon.png', serveStatic({ root: relRoot }))
  app.use('/logo.*', serveStatic({ root: relRoot }))

  // SPA fallback: serve index.html for all non-API GET requests
  const indexHtml = fs.readFileSync(path.join(FRONTEND_DIST, 'index.html'), 'utf8')
  app.get('*', (c) => c.html(indexHtml))
  logger.info('Serving frontend from ' + FRONTEND_DIST)
} else {
  app.notFound((c) => c.json({ error: `Route not found: ${c.req.method} ${c.req.path}` }, 404))
}

const PORT = Number(process.env.PORT) || 3001

const server = serve({ fetch: app.fetch, port: PORT }, (info) => {
  logger.info(`Twomiah Roam running on port ${info.port}`, {
    env: process.env.NODE_ENV || 'development',
    port: info.port,
    websocket: 'enabled',
  })
})

initializeSocket(server as any)

// Background follow-up sequence runner (sends due cadence steps)
startSequenceRunner()

const shutdown = async (signal: string) => {
  logger.info(`${signal} received, shutting down gracefully`)
  process.exit(0)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

export { app, db, io }
