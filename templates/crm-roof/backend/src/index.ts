import './config/publicUrl.ts'
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
import { company, roofReport, user } from '../db/schema.ts'
import { createSubscriptionSyncRoute, refreshSubscriptionFromFactory, createFactoryApiClient } from './shared/index.ts'
import logger from './services/logger.ts'
import { authenticate } from './middleware/auth.ts'
import { requireEnabledFeature } from './middleware/enabledFeature.ts'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const FRONTEND_DIST = path.resolve(__dirname, '..', 'frontend-dist')

import authRoutes from './routes/auth.ts'
import platformSupportRoutes from './routes/platformSupport.ts'
import messagingBillingRoutes from './routes/messagingBilling.ts'
import companyRoutes from './routes/company.ts'
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
import documentsRoutes from './routes/documents.ts'
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
import emailAliasesRoutes from './routes/emailAliases.ts'
import emailDomainRoutes from './routes/emailDomain.ts'
import accountRoutes from './routes/account.ts'
import inboundParseRoutes from './routes/inboundParse.ts'
import inboundMessagesRoutes from './routes/inboundMessages.ts'
import gbpRoutes, { gbpInternal } from './routes/gbp.ts'
import onboardingRoutes from './routes/onboarding.ts'
import mediaRoutes from './routes/media.ts'

const app = new Hono()

app.use('*', secureHeaders({
  crossOriginResourcePolicy: 'cross-origin',
}))

// Content-Security-Policy (propagated from crm-dispensary go-live QA L-7). The SPA is served
// from this origin; Vite emits external bundles (no inline scripts). Allowed third-party
// script surfaces: Stripe, Google Maps (address autocomplete), Leaflet from unpkg.
// img/connect stay broad (https:) because media lives on R2/customer URLs and the API host can
// differ from the page host on custom domains.
const CSP = [
  "default-src 'self'",
  "script-src 'self' https://js.stripe.com https://maps.googleapis.com https://maps.gstatic.com https://unpkg.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https:",
  "connect-src 'self' https: wss:",
  "frame-src https://js.stripe.com https://hooks.stripe.com https://www.google.com https://maps.google.com",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
  'upgrade-insecure-requests',
].join('; ')
app.use('*', async (c, next) => {
  await next()
  if (!c.res.headers.has('Content-Security-Policy')) c.res.headers.set('Content-Security-Policy', CSP)
})

// Paging guard (propagated from crm-dispensary go-live QA F-10). List endpoints read
// ?page/?limit with a bare cast: page=-1 produced a negative SQL OFFSET and limit=999999999
// was accepted uncapped. Validate once here — invalid values are a 400, not a server error.
const MAX_PAGE_LIMIT = 500
app.use('/api/*', async (c, next) => {
  const pageRaw = c.req.query('page')
  const limitRaw = c.req.query('limit')
  const isPosInt = (v: string) => /^\d+$/.test(v) && Number(v) >= 1
  if (pageRaw !== undefined && pageRaw !== '' && !isPosInt(pageRaw)) {
    return c.json({ error: 'Invalid page: must be an integer ≥ 1', code: 'invalid_pagination', page: pageRaw }, 400)
  }
  if (limitRaw !== undefined && limitRaw !== '' && (!isPosInt(limitRaw) || Number(limitRaw) > MAX_PAGE_LIMIT)) {
    return c.json({ error: `Invalid limit: must be an integer between 1 and ${MAX_PAGE_LIMIT}`, code: 'invalid_pagination', limit: limitRaw, max: MAX_PAGE_LIMIT }, 400)
  }
  await next()
})

// CORS — allow all origins; auth is handled by JWT, not origin checks
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'X-Request-ID'],
}))

// Rate limiter
function createRateLimiter(windowMs: number, max: number, countMethod?: (m: string) => boolean) {
  const hits = new Map<string, { count: number; resetAt: number }>()
  return async (c: Context, next: Next) => {
    if (countMethod && !countMethod(c.req.method)) return next()
    // Key on the CLIENT address only. x-forwarded-for is "client, hop, hop" and Render's edge appends a
    // varying hop, so keying on the whole header gave every request its own counter — 30 wrong
    // passwords in a row never hit the limit. (SALON-H5)
    const key = c.req.header('cf-connecting-ip') || (c.req.header('x-forwarded-for') || '').split(',')[0].trim() || 'unknown'
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

const isWrite = (m: string) => m === 'POST' || m === 'PUT' || m === 'PATCH' || m === 'DELETE'
// Reads and writes get independent buckets so browsing can't lock out saving.
app.use('/api/*', createRateLimiter(15 * 60 * 1000, process.env.NODE_ENV === 'production' ? 6000 : 100000, (m) => !isWrite(m)))
app.use('/api/*', createRateLimiter(15 * 60 * 1000, process.env.NODE_ENV === 'production' ? 1200 : 100000, isWrite))
// Per ADDRESS, not per account — so this is a ceiling on a flood from one place, not the thing that
// stops a person signing in. At 20 it was the latter: a salon is one Wi-Fi, and one stylist's twenty
// typos locked out the front desk, the manager and everybody else for fifteen minutes, with a message
// ("Too many requests") that named neither the cause nor the wait. The protection that belongs to a
// PERSON already exists and is better — the shared auth locks one account after 10 failures and says
// how long — it just never got to run. Ten accounts × ten failures is 100; 150 leaves room for a bad
// afternoon and still stops credential stuffing. (Salon T28 L9)
app.use('/api/auth/login', createRateLimiter(15 * 60 * 1000, 150))
app.use('/api/auth/forgot-password', createRateLimiter(15 * 60 * 1000, 20))
// Customer-portal sign-in: a 6-digit emailed code is only safe behind a per-IP cap on guesses.
app.use('/api/portal/login', createRateLimiter(15 * 60 * 1000, 10))
app.use('/api/portal/verify', createRateLimiter(15 * 60 * 1000, 10))

// Health check
app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString(), uptime: process.uptime() }))

// API routes
app.route('/api/auth', authRoutes)
app.route('/api/platform-support', platformSupportRoutes)
app.route('/api/messaging-billing', messagingBillingRoutes)
app.route('/api/email-aliases', emailAliasesRoutes)
app.route('/api/email-domain', emailDomainRoutes)
app.route('/api/account', accountRoutes)
app.route('/api/internal/inbound-email', inboundParseRoutes)
app.route('/api/inbound-messages', inboundMessagesRoutes)
app.route('/api/gbp', gbpRoutes)
app.route('/api/internal/gbp', gbpInternal)
app.route('/api/onboarding', onboardingRoutes)
app.route('/api/company', companyRoutes)
app.route('/api/contacts', contactsRoutes)
// Photo Capture has a real surface on roof — POST/GET/DELETE /api/jobs/:id/photos, and the before/after
// tabs on the job — but nothing enforced the flag, so the Settings toggle changed nothing and the business
// tier sold what every tier already had. Gated the way crm, crm-fieldservice and crm-landscaping already
// gate the same feature. This MUST sit above app.route('/api/jobs'): Hono matches in registration order,
// so middleware added after the route never runs. (roof T18 L9)
app.use('/api/jobs/:id/photos', authenticate, requireEnabledFeature('photo_capture'))
app.use('/api/jobs/:id/photos/*', authenticate, requireEnabledFeature('photo_capture'))

app.route('/api/jobs', jobsRoutes)
/**
 * M7: a feature switch that only hides the nav is not a switch.
 *
 * Switching lead_inbox off in Settings hid the menu and left /api/leads answering exactly as before,
 * so the data was still served to a tenant who is not paying for it and an unsubscribed module stayed
 * fully usable to anyone who kept a URL. `requireEnabledFeature` is the same gate the other eight
 * templates use; roof was the one that never wired it in.
 *
 * Only OPTIONAL modules are gated. contacts, jobs, quotes, invoices, dashboard, reports, settings,
 * users, company, auth, media, import and onboarding are the product itself — gating those would lock
 * a tenant out of their own CRM the moment a flag went missing.
 *
 * Both the bare path and the wildcard are needed: '/api/leads' does not match '/api/leads/*'.
 */
/**
 * The list is exactly what the PRODUCT treats as optional — the nav items in AppLayout that carry a
 * `feature:` key — plus lead_inbox, which is the one the tester proved and which is gated in the nav
 * in the same commit as this.
 *
 * A wider list was tried first and was wrong: gating insurance, crews, materials, measurements,
 * AI receptionist, SMS and QuickBooks switched off twelve modules on a tenant that had them in daily
 * use, because those nav items are shown unconditionally. The UI offering a page the API refuses is a
 * worse bug than the API serving a page the UI hides — it is a 403 in the user's face on a link the
 * product gave them.
 *
 * So the rule is: a module is gated on the server only where it is also gated in the nav. If one of
 * those is ever made optional, both sides change together.
 */
/**
 * Paths inside a gated module that are PUBLIC BY DESIGN, and must not meet `authenticate`.
 *
 * These are called by machines, not people: a lead source POSTs with a webhook secret, Wisetack signs
 * its callbacks, Twilio and CallRail post recordings and statuses. None of them carries a bearer
 * token, and each authenticates itself in its own handler.
 *
 * The first version of the M7 gate put `authenticate` in front of everything under a gated prefix and
 * broke exactly this: inbound lead capture and the Wisetack callback both answered 401 in production
 * until it was caught. The gate protects the CRM's own endpoints — it must not answer the door to the
 * outside world.
 */
const PUBLIC_WITHIN_GATED = [
  /^\/api\/leads\/inbound\//,               // lead-source webhook + inbound email
  /^\/api\/financing\/webhooks\//,          // Wisetack application status
  /^\/api\/calltracking\/webhook\//,        // CallRail / Twilio
  /^\/api\/ai-receptionist\/webhook\//,     // recording + call status
  /^\/api\/sms\/webhook$/,                  // Twilio inbound SMS — no bearer token, verifies itself
  // Not machines this time — CUSTOMERS, following a link we sent them. Same failure though: both
  // prefixes are gated ('/api/reviews' on google_reviews, '/api/roof-reports' on measurement_reports)
  // so the gate put `authenticate` in front of routes whose whole purpose is to work without a login.
  // A homeowner clicking the review link in their text got 401 and the tenant quietly stopped
  // collecting reviews; a shared link to a report they had already paid for did the same.
  // routes/reviews.ts registers /track ABOVE its own authenticate for exactly this reason, and
  // routes/roofReports.ts calls aerial.png and html "public — shareable link"; the mount-level gate
  // was overriding both.
  /^\/api\/reviews\/track\//,                            // review click-tracking link (SMS/email)
  /^\/api\/roof-reports\/[^/]+\/(html|aerial\.png)$/,    // shared view of an already-purchased report
]
const skipPublic = (mw: any) => async (c: any, next: any) => {
  let pathname = ''
  try { pathname = new URL(c.req.url).pathname } catch { pathname = c.req.path || '' }
  return PUBLIC_WITHIN_GATED.some((re) => re.test(pathname)) ? next() : mw(c, next)
}

for (const [path, feature] of [
  ['/api/leads', 'lead_inbox'],
  ['/api/canvassing', 'canvassing_tool'],
  ['/api/storms', 'storm_lead_gen'],
  ['/api/storm-radar', 'storm_radar_overlay'],
  ['/api/roof-reports', 'measurement_reports'],
  ['/api/financing', 'consumer_financing'],
  ['/api/reviews', 'google_reviews'],
  // A roofer who only does retail never touches a carrier, so the claims module is genuinely
  // optional — and it is the switch with real commercial meaning on this template.
  ['/api/insurance', 'insurance_workflow'],
  // The AI receptionist page is the only consumer of /api/calltracking on roof — there is no
  // call-tracking screen of its own — so the two are one surface here and share one switch.
  ['/api/ai-receptionist', 'ai_receptionist'],
  ['/api/calltracking', 'ai_receptionist'],
  // Roofing runs on paperwork; the module is shared and five other templates already mount it.
  ['/api/documents', 'documents'],
  // T18 M7 remainder — these three answered 200 with the switch off, so the plan tiers meant nothing
  // for them. `materials` is business-tier, `quickbooks` and `two_way_texting` are pro.
  ['/api/materials', 'materials'],
  ['/api/quickbooks', 'quickbooks'],
  // /api/sms/webhook is exempted above: Twilio posts an inbound message with no bearer token.
  ['/api/sms', 'two_way_texting'],
] as Array<[string, string]>) {
  app.use(path, skipPublic(authenticate), skipPublic(requireEnabledFeature(feature)))
  app.use(`${path}/*`, skipPublic(authenticate), skipPublic(requireEnabledFeature(feature)))
}

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
app.route('/api/documents', documentsRoutes)
app.route('/api/calltracking', calltrackingRoutes)
app.route('/api/ai-receptionist', aiReceptionistRoutes)
app.route('/api/ads', adsRoutes)
const adsPublicRoutes = (await import('./routes/adsPublic.ts')).default
app.route('/api/public/ads-experiments', adsPublicRoutes)
app.route('/api/estimator', estimatorRoutes) // public — no auth
app.route('/api/roof-reports', roofReportsRoutes)
app.route('/api/import', importRoutes)
app.route('/api/users', usersRoutes)
app.route('/api/billing', billingRoutes)
app.route('/api/reviews', reviewsRoutes)
app.route('/api/financing', financingRoutes)
app.route('/api/storm-radar', stormRadarRoutes)
// Public media proxy for uploaded photos (streamed from private R2). Must be
// registered before the static/SPA catch-all below so /media/* is not swallowed.
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

// Factory → tenant push of the subscription summary (same X-Factory-Key as sync-features). A tenant
// never computes billing state itself: plans, trials and suspensions are decided in the Factory, and
// Settings → Billing plus the trial gate read the mirror this writes into company.settings.
const subscriptionDeps = { db, companyTable: company, userTable: user, factoryApiClient: createFactoryApiClient(), seatLimitEnv: process.env.SEAT_LIMIT }
app.route('/api/internal/sync-subscription', createSubscriptionSyncRoute(subscriptionDeps))

// Path A++ — seed CRM owner with credentials matching the premium
// admin. See templates/crm-fieldservice/backend/src/index.ts for the
// canonical implementation + commentary.
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
  const existing = (await db.select().from(user).where(eq(user.email, email)).limit(1))[0]
  if (existing) {
    await db.update(user).set({ passwordHash, role: 'owner', isActive: true, updatedAt: new Date() }).where(eq(user.id, existing.id))
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

// Internal SMS send for Twomiah Bookings — the website-premium service
// POSTs here when a booking is confirmed so we send the SMS via this
// tenant's Twilio credentials (which only live in the CRM env).
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

  // Money that will not fit decimal(10,2). It is the caller's input that is wrong, so it is a 400
  // with the number named — not the 500 a numeric overflow produces on its way out of the driver.
  if (err.name === 'QuoteTooLargeError' || err.name === 'DiscountTooLargeError') {
    return c.json({ error: err.message }, 400)
  }

  if (err.name === 'ZodError') {
    // Name the offending field in the message so the UI can show something
    // useful instead of a bare "Validation error".
    const issues = (err as any).issues || []
    const first = issues[0] || {}
    const where = Array.isArray(first.path) && first.path.length ? first.path.join('.') + ': ' : ''
    return c.json({ error: where + (first.message || 'Validation error'), details: issues }, 400)
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
        // Vite's own output is content-hashed (/assets/index-<hash>.js), so it can be cached hard: the
        // name changes whenever the bytes do. Everything else — booking-widget.js above all, which is
        // embedded on the customer's own website — keeps its name across deploys, so a long cache means
        // a fix cannot reach anybody for a day. That is exactly what happened to the widget. (T29 L4)
        // Vite's separator is a HYPHEN: index-BDFO1_KD.js. Matching only "name.hash.ext" meant no bundle
        // was ever recognised as hashed, so they all revalidated every five minutes. (T29)
        const hashed = /^\/assets\//.test(c.req.path) && /[-.][A-Za-z0-9_-]{8,}\.(js|css|woff2?|png|jpe?g|svg)$/.test(c.req.path)
        const cache = hashed ? 'public, max-age=31536000, immutable' : 'public, max-age=300, must-revalidate'
        return c.body(body, 200, { 'Content-Type': mime, 'Cache-Control': cache })
      }
    } catch {}
    return next()
  })

  // An unmatched /api/* request must 404 in JSON, not fall through to the SPA
  // catch-all below (which would return index.html with a 200 and let a client
  // mistake HTML for a successful JSON response).
  app.all('/api/*', (c) => c.json({ error: `Route not found: ${c.req.method} ${c.req.path}` }, 404))

  // SPA fallback: serve index.html for all non-API GET requests
  const indexHtml = fs.readFileSync(path.join(FRONTEND_DIST, 'index.html'), 'utf8')
  app.get('*', (c) => c.html(indexHtml, 200, { 'Cache-Control': 'no-store' }))
  logger.info('Serving frontend from ' + FRONTEND_DIST)
} else {
  app.notFound((c) => c.json({ error: `Route not found: ${c.req.method} ${c.req.path}` }, 404))
}

const PORT = Number(process.env.PORT) || 3001

// Pull the current subscription from the Factory at boot so the mirror is right even if a push was missed.
refreshSubscriptionFromFactory(subscriptionDeps).catch(console.error)

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
