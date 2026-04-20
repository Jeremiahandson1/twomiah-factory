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
import { eq, desc } from 'drizzle-orm'
import { company, roofReport } from '../db/schema.ts'
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
import leadsRoutes from './routes/leads.ts'
import calltrackingRoutes from './routes/calltracking.ts'
import aiReceptionistRoutes from './routes/aiReceptionist.ts'
import adsRoutes from './routes/ads.ts'
import roofReportsRoutes from './routes/roofReports.ts'
import importRoutes from './routes/import.ts'
import usersRoutes from './routes/users.ts'
import billingRoutes from './routes/billing.ts'
import reviewsRoutes from './routes/reviews.ts'
import financingRoutes from './routes/financing.ts'
import stormRadarRoutes from './routes/stormRadar.ts'
import providerIntegrationRoutes from './routes/providerIntegrations.ts'
import webhookRoutes from './routes/webhooks.ts'
import emailAliasesRoutes from './routes/emailAliases.ts'
import emailDomainRoutes from './routes/emailDomain.ts'
import accountRoutes from './routes/account.ts'
import inboundParseRoutes from './routes/inboundParse.ts'
import inboundMessagesRoutes from './routes/inboundMessages.ts'
import onboardingRoutes from './routes/onboarding.ts'

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
app.route('/api/email-aliases', emailAliasesRoutes)
app.route('/api/email-domain', emailDomainRoutes)
app.route('/api/account', accountRoutes)
app.route('/api/internal/inbound-email', inboundParseRoutes)
app.route('/api/inbound-messages', inboundMessagesRoutes)
app.route('/api/onboarding', onboardingRoutes)
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
app.route('/api/leads', leadsRoutes)
app.route('/api/calltracking', calltrackingRoutes)
app.route('/api/ai-receptionist', aiReceptionistRoutes)
app.route('/api/ads', adsRoutes)
app.route('/api/estimator', estimatorRoutes) // public — no auth
app.route('/api/roof-reports', roofReportsRoutes)
app.route('/api/import', importRoutes)
app.route('/api/users', usersRoutes)
app.route('/api/billing', billingRoutes)
app.route('/api/reviews', reviewsRoutes)
app.route('/api/financing', financingRoutes)
app.route('/api/storm-radar', stormRadarRoutes)
app.route('/api/integrations', providerIntegrationRoutes)
app.route('/api/webhooks', webhookRoutes)

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

// --- Factory-facing internal endpoints for roof report review ---

function requireFactoryKey(c: any): boolean {
  const syncKey = process.env.FACTORY_SYNC_KEY
  if (!syncKey) return false
  return c.req.header('X-Factory-Key') === syncKey
}

// Get pending review reports
app.get('/api/internal/roof-reports/pending', async (c) => {
  if (!requireFactoryKey(c)) return c.json({ error: 'Unauthorized' }, 401)
  const reports = await db.select().from(roofReport).where(eq(roofReport.status, 'pending_review')).orderBy(desc(roofReport.createdAt))
  return c.json(reports)
})

// Get a specific report (full data for editor)
app.get('/api/internal/roof-reports/:id', async (c) => {
  if (!requireFactoryKey(c)) return c.json({ error: 'Unauthorized' }, 401)
  const [report] = await db.select().from(roofReport).where(eq(roofReport.id, c.req.param('id'))).limit(1)
  if (!report) return c.json({ error: 'Not found' }, 404)
  return c.json(report)
})

// Approve a report (update edges + set status to completed)
app.post('/api/internal/roof-reports/:id/approve', async (c) => {
  if (!requireFactoryKey(c)) return c.json({ error: 'Unauthorized' }, 401)
  const id = c.req.param('id')
  const { edges, measurements } = await c.req.json()

  const [report] = await db.select().from(roofReport).where(eq(roofReport.id, id)).limit(1)
  if (!report) return c.json({ error: 'Not found' }, 404)

  // Save original auto-detected edges as training data
  const updateData: Record<string, any> = {
    status: 'completed',
    edges: edges || report.edges,
    measurements: measurements || report.measurements,
    updatedAt: new Date(),
  }
  if (!report.userEdited) {
    updateData.userEdited = true
    updateData.originalEdges = report.edges
    updateData.originalMeasurements = report.measurements
  }

  await db.update(roofReport).set(updateData).where(eq(roofReport.id, id))
  return c.json({ success: true })
})

// Serve aerial image for factory editor
app.get('/api/internal/roof-reports/:id/aerial', async (c) => {
  if (!requireFactoryKey(c)) return c.json({ error: 'Unauthorized' }, 401)
  const [report] = await db.select().from(roofReport).where(eq(roofReport.id, c.req.param('id'))).limit(1)
  if (!report?.aerialImagePath) return c.json({ error: 'No image' }, 404)
  const fs = await import('fs')
  if (!fs.existsSync(report.aerialImagePath)) return c.json({ error: 'Image file missing' }, 404)
  const buf = fs.readFileSync(report.aerialImagePath)
  return new Response(buf, { headers: { 'Content-Type': 'image/png' } })
})

// Error handler
app.onError((err, c) => {
  logger.error('Unhandled error', { message: err.message, stack: err.stack, path: c.req.path, method: c.req.method })

  if (err.name === 'ZodError') {
    return c.json({ error: 'Validation error', details: (err as any).issues }, 400)
  }

  return c.json({ error: 'Internal server error' }, 500)
})

// MIME type map for Bun runtime (serveStatic sometimes serves as text/plain)
const MIME_TYPES: Record<string, string> = {
  '.css': 'text/css', '.js': 'application/javascript', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.html': 'text/html',
}

// Serve frontend SPA from backend
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
  app.get('*', (c) => c.html(indexHtml))
  logger.info('Serving frontend from ' + FRONTEND_DIST)
} else {
  app.notFound((c) => c.json({ error: `Route not found: ${c.req.method} ${c.req.path}` }, 404))
}

const PORT = Number(process.env.PORT) || 3001

const server = serve({ fetch: app.fetch, port: PORT, hostname: '0.0.0.0' }, (info) => {
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
