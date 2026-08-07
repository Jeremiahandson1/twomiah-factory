import './config/publicUrl.ts'
import { Hono } from 'hono'
import { startMarketingProcessor } from './services/marketing.ts'
import { startAgreementBillingProcessor } from './services/agreements.ts'
import type { Context, Next } from 'hono'
import { cors } from 'hono/cors'
import { secureHeaders } from 'hono/secure-headers'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { db } from '../db/index.ts'
import { eq } from 'drizzle-orm'
import { company, user } from '../db/schema.ts'
import logger from './services/logger.ts'
import { initializeSocket, io } from './services/socket.ts'
import { authenticate } from './middleware/auth.ts'
import { errorHandler, handleUncaughtExceptions } from './utils/errors.ts'
import { syncFeatures } from './startup/featureSync.ts'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const FRONTEND_DIST = path.resolve(__dirname, '..', 'frontend-dist')

import authRoutes from './routes/auth.ts'
import platformSupportRoutes from './routes/platformSupport.ts'
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
import locationsRoutes from './routes/locations.ts'
import commissionsRoutes from './routes/commissions.ts'
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
import techRoutes from './routes/tech.ts'
import timeTrackingRoutes from './routes/timeTracking.ts'
import warrantiesRoutes from './routes/warranties.ts'
import weatherRoutes from './routes/weather.ts'
import supportRoutes from './routes/support.ts'
import leadsRoutes from './routes/leads.ts'
import wisetackRoutes from './routes/wisetack.ts'
import adsRoutes from './routes/ads.ts'
import aiReceptionistRoutes from './routes/aiReceptionist.ts'
import emailAliasesRoutes from './routes/emailAliases.ts'
import emailDomainRoutes from './routes/emailDomain.ts'
import accountRoutes from './routes/account.ts'
import inboundParseRoutes from './routes/inboundParse.ts'
import inboundMessagesRoutes from './routes/inboundMessages.ts'
import gbpRoutes, { gbpInternal } from './routes/gbp.ts'
import onboardingRoutes from './routes/onboarding.ts'
import mediaRoutes from './routes/media.ts'
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
app.route('/api/platform-support', platformSupportRoutes)
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
app.route('/api/email-aliases', emailAliasesRoutes)
app.route('/api/email-domain', emailDomainRoutes)
app.route('/api/account', accountRoutes)
app.route('/api/internal/inbound-email', inboundParseRoutes)
app.route('/api/inbound-messages', inboundMessagesRoutes)
app.route('/api/gbp', gbpRoutes)
app.route('/api/internal/gbp', gbpInternal)
app.route('/api/onboarding', onboardingRoutes)
app.route('/api/dashboard', dashboardRoutes)
app.route('/api/documents', documentsRoutes)
app.route('/api/billing', billingRoutes)
app.route('/api/integrations', integrationsRoutes)
app.route('/api/agency', agencyAdminRoutes)
app.route('/api/agreements', agreementsRoutes)
app.route('/api/maintenance-contracts', agreementsRoutes)
app.route('/api/audit', auditRoutes)
app.route('/api/booking', bookingRoutes)
app.route('/api/bulk', bulkRoutes)
app.route('/api/calltracking', calltrackingRoutes)
app.route('/api/comments', commentsRoutes)
app.route('/api/equipment', equipmentRoutes)
app.route('/api/export', exportRoutes)
app.route('/api/fleet', fleetRoutes)
app.route('/api/locations', locationsRoutes)
app.route('/api/commissions', commissionsRoutes)
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
app.route('/api/tech', techRoutes)
app.route('/api/time-tracking', timeTrackingRoutes)
app.route('/api/warranties', warrantiesRoutes)
app.route('/api/weather', weatherRoutes)
app.route('/api/support', supportRoutes)
app.route('/api/leads', leadsRoutes)
app.route('/api/wisetack', wisetackRoutes)
app.route('/api/ads', adsRoutes)
// Public visitor tracking — no auth, called from tenant public website JS
const adsPublicRoutes = (await import('./routes/adsPublic.ts')).default
app.route('/api/public/ads-experiments', adsPublicRoutes)
app.route('/api/ai-receptionist', aiReceptionistRoutes)
// Public media proxy for uploaded photos (streamed from private R2). Must be
// registered before the static/SPA catch-all so /media/* is not swallowed.
app.route('/media', mediaRoutes)

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

// Path A++ — SSO handoff from the premium admin. Premium signs a
// short-lived JWT (60s, aud=twomiah-crm) using this CRM's
// FACTORY_SYNC_KEY (the factory mints it on premium's behalf so
// premium doesn't need the secret), browser is redirected here with
// the token in the query. We verify, find the seeded user by email,
// mint a normal CRM session, drop the access+refresh tokens into
// localStorage via a tiny inline script, then send the customer to
// the dashboard. Looks like one click to the customer.
app.get('/auth/handoff', async (c) => {
  const token = c.req.query('token') || ''
  if (!token) return c.text('Missing handoff token', 400)
  const syncKey = process.env.FACTORY_SYNC_KEY
  if (!syncKey) return c.text('SSO not configured on this CRM', 503)
  const jwtLib = (await import('jsonwebtoken')).default
  let decoded: { sub?: string; aud?: string; iss?: string }
  try {
    decoded = jwtLib.verify(token, syncKey, { audience: 'twomiah-crm' }) as any
  } catch (e: any) {
    return c.text('Invalid or expired handoff token: ' + e?.message, 401)
  }
  const email = String(decoded.sub || '').toLowerCase().trim()
  if (!email) return c.text('Token missing subject', 401)
  const [foundUser] = await db.select().from(user).where(eq(user.email, email)).limit(1)
  if (!foundUser || !foundUser.isActive) return c.text('User not found — try signing in directly.', 401)
  const [foundCompany] = await db.select().from(company).where(eq(company.id, foundUser.companyId)).limit(1)
  if (!foundCompany) return c.text('Company not found', 404)
  const accessToken = jwtLib.sign(
    { userId: foundUser.id, companyId: foundUser.companyId, email: foundUser.email, role: foundUser.role },
    process.env.JWT_SECRET!,
    { expiresIn: '15m' }
  )
  const refreshToken = jwtLib.sign(
    { userId: foundUser.id, companyId: foundUser.companyId, type: 'refresh' },
    process.env.JWT_REFRESH_SECRET!,
    { expiresIn: '7d' }
  )
  await db.update(user)
    .set({ refreshToken, lastLogin: new Date(), updatedAt: new Date() })
    .where(eq(user.id, foundUser.id))
  // Inline-script landing page — writes tokens to localStorage (where
  // the React SPA reads them) and bounces to the dashboard. JSON.stringify
  // gives us safe escaping inside the script tag.
  const safeAccess = JSON.stringify(accessToken)
  const safeRefresh = JSON.stringify(refreshToken)
  return c.html(`<!doctype html><meta charset="utf-8"><title>Signing you in…</title>
<body style="margin:0;font:14px -apple-system,Segoe UI,Roboto,sans-serif;background:#fafaf7;color:#555;display:flex;align-items:center;justify-content:center;height:100vh;">
  <div style="text-align:center;">
    <div style="font-size:13px;letter-spacing:0.14em;text-transform:uppercase;color:#888;margin-bottom:8px;">TWOMIAH</div>
    <div>Signing you in to your CRM…</div>
  </div>
  <script>
    try {
      localStorage.setItem('accessToken', ${safeAccess});
      localStorage.setItem('refreshToken', ${safeRefresh});
      window.location.replace('/');
    } catch (e) {
      document.body.innerText = 'Could not complete sign-in: ' + (e && e.message ? e.message : e);
    }
  </script>
</body>`)
})

// Path A++ — seed the CRM's owner row with credentials matching the
// existing premium-website admin. Called by the factory script
// provision-crm-for-tenant.ts immediately after a Premium customer
// adds the CRM via Stripe. The bcrypt hash is taken verbatim — bcryptjs
// (premium) and Bun.password.verify (CRM) both accept $2a$ and $2b$
// prefixes, so cross-implementation hashes interoperate.
app.post('/api/internal/seed-from-premium', async (c) => {
  const syncKey = process.env.FACTORY_SYNC_KEY
  if (!syncKey) return c.json({ error: 'Sync not configured' }, 503)
  if (c.req.header('X-Factory-Key') !== syncKey) return c.json({ error: 'Unauthorized' }, 401)
  const body = await c.req.json().catch(() => ({})) as { email?: string; passwordHash?: string; name?: string }
  const email = String(body.email || '').trim().toLowerCase()
  const passwordHash = String(body.passwordHash || '')
  if (!email || !passwordHash) return c.json({ error: 'email and passwordHash required' }, 400)
  const [comp] = await db.select().from(company).limit(1)
  if (!comp) return c.json({ error: 'No company found' }, 404)
  const [firstName, ...rest] = (body.name || '').trim().split(/\s+/)
  const lastName = rest.join(' ') || ''
  // Drizzle ORM lacks a clean ON CONFLICT for this composite key in
  // every version, so do find-or-create with a guarded update.
  const existing = (await db.select().from(user).where(eq(user.email, email)).limit(1))[0]
  if (existing) {
    await db.update(user).set({
      passwordHash, role: 'owner', isActive: true, updatedAt: new Date(),
    }).where(eq(user.id, existing.id))
    return c.json({ success: true, action: 'updated', userId: existing.id })
  }
  const [created] = await db.insert(user).values({
    email, passwordHash,
    firstName: firstName || 'Owner', lastName: lastName || '',
    role: 'owner', isActive: true,
    companyId: comp.id,
  }).returning({ id: user.id })
  return c.json({ success: true, action: 'created', userId: created.id })
})

// CRM SchedulePage pulls Twomiah Bookings from the connected website-
// premium service. Auth-gated by the CRM's own JWT (whoever can see
// jobs can see bookings); server-to-server call uses FACTORY_SYNC_KEY.
app.get('/api/bookings/external', authenticate, async (c) => {
  const websiteUrl = process.env.WEBSITE_PREMIUM_URL
  const syncKey = process.env.FACTORY_SYNC_KEY
  if (!websiteUrl || !syncKey) return c.json({ bookings: [] })
  const fromQ = c.req.query('from')
  const toQ = c.req.query('to')
  const url = new URL(websiteUrl.replace(/\/$/, '') + '/api/internal/bookings')
  if (fromQ) url.searchParams.set('from', fromQ)
  if (toQ) url.searchParams.set('to', toQ)
  try {
    const r = await fetch(url.toString(), { headers: { 'X-Factory-Key': syncKey } })
    if (!r.ok) return c.json({ bookings: [], error: 'upstream ' + r.status }, 502)
    const data = await r.json() as any
    return c.json({ bookings: data.bookings || [] })
  } catch (e: any) {
    return c.json({ bookings: [], error: e?.message || 'fetch failed' }, 502)
  }
})

// Internal SMS send for Twomiah Bookings — the website-premium service
// POSTs here when a booking is confirmed so we send the SMS via this
// tenant's Twilio credentials (which only live in the CRM env).
app.post('/api/internal/send-sms', async (c) => {
  const syncKey = process.env.FACTORY_SYNC_KEY
  if (!syncKey) return c.json({ error: 'Sync not configured' }, 503)
  if (c.req.header('X-Factory-Key') !== syncKey) return c.json({ error: 'Unauthorized' }, 401)
  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  const from = process.env.TWILIO_PHONE_NUMBER
  if (!sid || !token || !from) return c.json({ error: 'Twilio not configured' }, 503)
  const { to, body } = await c.req.json().catch(() => ({})) as { to?: string; body?: string }
  if (!to || !body) return c.json({ error: 'to + body required' }, 400)
  try {
    const url = 'https://api.twilio.com/2010-04-01/Accounts/' + sid + '/Messages.json'
    const form = new URLSearchParams({ To: to, From: from, Body: body })
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(sid + ':' + token).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form,
    })
    if (!res.ok) return c.json({ error: 'Twilio: ' + (await res.text().catch(() => res.statusText)) }, 502)
    const data: any = await res.json()
    return c.json({ ok: true, sid: data.sid })
  } catch (e: any) {
    return c.json({ error: e?.message || 'send failed' }, 500)
  }
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
    websocket: 'enabled',
  })
})

initializeSocket(server as any)

startMarketingProcessor()
startAgreementBillingProcessor()
syncFeatures().catch(console.error)

// Recurring scheduling background job — scan every 6 hours
import('./services/agreements.ts').then(({ default: agreementService }) => {
  const runScheduler = () => agreementService.scanAndGenerateJobs().catch(console.error)
  runScheduler() // Run on startup
  setInterval(runScheduler, 6 * 60 * 60 * 1000) // Then every 6 hours
}).catch(console.error)

const shutdown = async (signal: string) => {
  logger.info(`${signal} received, shutting down gracefully`)
  process.exit(0)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

export { app, db, io }
