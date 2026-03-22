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
import { eq } from 'drizzle-orm'
import { agencies } from '../db/schema.ts'
import logger from './services/logger.ts'
import { initializeSocket, io } from './services/socket.ts'
import { errorHandler, handleUncaughtExceptions } from './utils/errors.ts'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const FRONTEND_DIST = path.resolve(__dirname, '..', 'frontend-dist')

import authRoutes from './routes/auth.ts'
import dashboardRoutes from './routes/dashboard.ts'
import clientsRoutes from './routes/clients.ts'
import caregiversRoutes from './routes/caregivers.ts'
import schedulingRoutes from './routes/scheduling.ts'
import timeTrackingRoutes from './routes/timeTracking.ts'
import billingRoutes from './routes/billing.ts'
let payrollRoutes: any = null
try { payrollRoutes = (await import('./routes/payroll.ts')).default } catch {}
import complianceRoutes from './routes/compliance.ts'
import communicationRoutes from './routes/communication.ts'
import documentsRoutes from './routes/documents.ts'
import notificationsRoutes from './routes/notifications.ts'
import pushRoutes from './routes/push.ts'
import smsRoutes from './routes/sms.ts'
import portalRoutes from './routes/portal.ts'
import reportsRoutes from './routes/reports.ts'
import formsRoutes from './routes/forms.ts'
// Feature-gated routes: dynamically imported so the app doesn't crash if the
// generator stripped the file because the feature wasn't selected.
let evvRoutes: any = null
try { evvRoutes = (await import('./routes/evv.ts')).default } catch {}
let ediRoutes: any = null
try { ediRoutes = (await import('./routes/edi.ts')).default } catch {}
let claimsRoutes: any = null
try { claimsRoutes = (await import('./routes/claims.ts')).default } catch {}
let remittanceRoutes: any = null
try { remittanceRoutes = (await import('./routes/remittance.ts')).default } catch {}
import authorizationsRoutes from './routes/authorizations.ts'
import serviceCodesRoutes from './routes/serviceCodes.ts'
import payersRoutes from './routes/payers.ts'
import auditRoutes from './routes/audit.ts'
import companyRoutes from './routes/company.ts'
import stripeRoutes from './routes/stripe.ts'
import helpRoutes from './routes/help.ts'
import optimizerRoutes from './routes/optimizer.ts'
import scheduleOptimizerRoutes from './routes/scheduleOptimizer.ts'
import paymentsRoutes from './routes/payments.ts'
let leadsRoutes: any = null
try { leadsRoutes = (await import('./routes/leads.ts')).default } catch {}
import adlRoutes from './routes/adl.ts'
import applicationsRoutes from './routes/applications.ts'
import alertsRoutes from './routes/alerts.ts'
import emergencyRoutes from './routes/emergency.ts'
import absencesRoutes from './routes/absences.ts'
import auditLogsRoutes from './routes/auditLogs.ts'
import backgroundChecksRoutes from './routes/backgroundChecks.ts'
import blackoutDatesRoutes from './routes/blackoutDates.ts'
import carePlansRoutes from './routes/carePlans.ts'
import careTypesRoutes from './routes/careTypes.ts'
import caregiverAvailabilityRoutes from './routes/caregiverAvailability.ts'
import caregiverCareTypeRatesRoutes from './routes/caregiverCareTypeRates.ts'
import caregiverRatesRoutes from './routes/caregiverRates.ts'
import caregiverProfileRoutes from './routes/caregiverProfile.ts'
import certificationsRoutes from './routes/certifications.ts'
import communicationLogRoutes from './routes/communicationLog.ts'
import expensesRoutes from './routes/expenses.ts'
import familyPortalRoutes from './routes/familyPortal.ts'
import forecastRoutes from './routes/forecast.ts'
let gustoRoutes: any = null
try { gustoRoutes = (await import('./routes/gusto.ts')).default } catch {}
import incidentsRoutes from './routes/incidents.ts'
import matchingRoutes from './routes/matching.ts'
import medicationsRoutes from './routes/medications.ts'
import messagesRoutes from './routes/messages.ts'
import mileageRoutes from './routes/mileage.ts'
import noShowRoutes from './routes/noShow.ts'
import notificationSettingsRoutes from './routes/notificationSettings.ts'
import openShiftsRoutes from './routes/openShifts.ts'
import performanceReviewsRoutes from './routes/performanceReviews.ts'
import prospectAppointmentsRoutes from './routes/prospectAppointments.ts'
import prospectsRoutes from './routes/prospects.ts'
import ptoRoutes from './routes/pto.ts'
import referralSourcesRoutes from './routes/referralSources.ts'
import rosterOptimizerRoutes from './routes/rosterOptimizer.ts'
let sandataRoutes: any = null
try { sandataRoutes = (await import('./routes/sandata.ts')).default } catch {}
import schedulesAllRoutes from './routes/schedulesAll.ts'
import schedulesEnhancedRoutes from './routes/schedulesEnhanced.ts'
import shiftSwapsRoutes from './routes/shiftSwaps.ts'
import scheduleExceptionsRoutes from './routes/scheduleExceptions.ts'
import payrollShiftReviewsRoutes from './routes/payrollShiftReviews.ts'
import ivrRoutes from './routes/ivr.ts'
import trainingRecordsRoutes from './routes/trainingRecords.ts'
import failsafeRoutes from './routes/failsafe.ts'
import calltrackingRoutes from './routes/calltracking.ts'
import aiReceptionistRoutes from './routes/aiReceptionist.ts'
import adsRoutes from './routes/ads.ts'
import pricingRoutes from './routes/pricing.ts'
let webhooksRoutes: any = null
try { webhooksRoutes = (await import('./routes/webhooks.ts')).default } catch {}

handleUncaughtExceptions()

const app = new Hono()

// Security headers
app.use('*', secureHeaders({
  crossOriginResourcePolicy: 'cross-origin',
}))

// CORS — allow all origins; auth is handled by JWT, not origin checks
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'x-portal-token'],
}))

// Simple in-memory rate limiter
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

app.use('/api/*', createRateLimiter(15 * 60 * 1000, process.env.NODE_ENV === 'production' ? 200 : 1000))
app.use('/api/auth/login', createRateLimiter(15 * 60 * 1000, 20))

// Health check
app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString(), uptime: process.uptime() }))

// API routes
if (webhooksRoutes) app.route('/api/webhooks', webhooksRoutes)
app.route('/api/auth', authRoutes)
app.route('/api/dashboard', dashboardRoutes)
app.route('/api/clients', clientsRoutes)
app.route('/api/caregivers', caregiversRoutes)
app.route('/api/scheduling', schedulingRoutes)
app.route('/api/time-tracking', timeTrackingRoutes)
app.route('/api/billing', billingRoutes)
if (payrollRoutes) app.route('/api/payroll', payrollRoutes)
app.route('/api/compliance', complianceRoutes)
app.route('/api/communication', communicationRoutes)
app.route('/api/documents', documentsRoutes)
app.route('/api/notifications', notificationsRoutes)
app.route('/api/push', pushRoutes)
app.route('/api/sms', smsRoutes)
app.route('/api/portal', portalRoutes)
app.route('/api/reports', reportsRoutes)
app.route('/api/forms', formsRoutes)
if (evvRoutes) app.route('/api/evv', evvRoutes)
if (ediRoutes) app.route('/api/edi', ediRoutes)
if (claimsRoutes) app.route('/api/claims', claimsRoutes)
if (remittanceRoutes) app.route('/api/remittance', remittanceRoutes)
app.route('/api/authorizations', authorizationsRoutes)
app.route('/api/service-codes', serviceCodesRoutes)
app.route('/api/payers', payersRoutes)
app.route('/api/audit', auditRoutes)
app.route('/api/company', companyRoutes)
app.route('/api/stripe', stripeRoutes)
app.route('/api/help', helpRoutes)
app.route('/api/optimizer', optimizerRoutes)
app.route('/api/optimizer', scheduleOptimizerRoutes)
app.route('/api/payments', paymentsRoutes)
if (leadsRoutes) app.route('/api/leads', leadsRoutes)
app.route('/api/adl', adlRoutes)
app.route('/api/applications', applicationsRoutes)
app.route('/api/alerts', alertsRoutes)
app.route('/api/emergency', emergencyRoutes)
app.route('/api/absences', absencesRoutes)
app.route('/api/audit-logs', auditLogsRoutes)
app.route('/api/background-checks', backgroundChecksRoutes)
app.route('/api/blackout-dates', blackoutDatesRoutes)
app.route('/api/care-plans', carePlansRoutes)
app.route('/api/care-types', careTypesRoutes)
app.route('/api/caregiver-availability', caregiverAvailabilityRoutes)
app.route('/api/caregiver-care-type-rates', caregiverCareTypeRatesRoutes)
app.route('/api/caregiver-rates', caregiverRatesRoutes)
app.route('/api/caregiver-profile', caregiverProfileRoutes)
app.route('/api/certifications', certificationsRoutes)
app.route('/api/communication-log', communicationLogRoutes)
app.route('/api/expenses', expensesRoutes)
app.route('/api/family-portal', familyPortalRoutes)
app.route('/api/forecast', forecastRoutes)
if (gustoRoutes) app.route('/api/gusto', gustoRoutes)
app.route('/api/incidents', incidentsRoutes)
app.route('/api/matching', matchingRoutes)
app.route('/api/medications', medicationsRoutes)
app.route('/api/messages', messagesRoutes)
app.route('/api/mileage', mileageRoutes)
app.route('/api/no-show', noShowRoutes)
app.route('/api/notification-settings', notificationSettingsRoutes)
app.route('/api/open-shifts', openShiftsRoutes)
app.route('/api/performance-reviews', performanceReviewsRoutes)
app.route('/api/prospect-appointments', prospectAppointmentsRoutes)
app.route('/api/prospects', prospectsRoutes)
app.route('/api/pto', ptoRoutes)
app.route('/api/referral-sources', referralSourcesRoutes)
app.route('/api/roster-optimizer', rosterOptimizerRoutes)
if (sandataRoutes) app.route('/api/sandata', sandataRoutes)
app.route('/api/schedules-all', schedulesAllRoutes)
app.route('/api/schedules-enhanced', schedulesEnhancedRoutes)
app.route('/api/shift-swaps', shiftSwapsRoutes)
app.route('/api/schedule-exceptions', scheduleExceptionsRoutes)
app.route('/api/payroll-shift-reviews', payrollShiftReviewsRoutes)
app.route('/api/ivr', ivrRoutes)
app.route('/api/training-records', trainingRecordsRoutes)
app.route('/api/failsafe', failsafeRoutes)
app.route('/api/calltracking', calltrackingRoutes)
app.route('/api/ai-receptionist', aiReceptionistRoutes)
app.route('/api/ads', adsRoutes)
app.route('/api/pricing', pricingRoutes)

// ── Alias mounts: frontend uses shorthand paths for some routes ──
app.route('/api/schedules', schedulingRoutes)
app.route('/api/time-entries', timeTrackingRoutes)
app.route('/api/users', caregiversRoutes)
app.route('/api/route-optimizer', optimizerRoutes)

app.post('/api/internal/sync-features', async (c) => {
  const syncKey = process.env.FACTORY_SYNC_KEY
  if (!syncKey) return c.json({ error: 'Sync not configured' }, 503)
  const authHeader = c.req.header('X-Factory-Key')
  if (authHeader !== syncKey) return c.json({ error: 'Unauthorized' }, 401)
  const { features } = await c.req.json()
  if (!Array.isArray(features)) return c.json({ error: 'features must be an array' }, 400)
  const [agency] = await db.select().from(agencies).limit(1)
  if (!agency) return c.json({ error: 'No agency found' }, 404)
  const currentSettings = (agency.settings || {}) as Record<string, any>
  currentSettings.enabledFeatures = features
  await db.update(agencies).set({ settings: currentSettings }).where(eq(agencies.id, agency.id))
  return c.json({ success: true, features })
})

// Error handler
app.onError(errorHandler)

// ── API 404 handler: catch unmatched /api/* before SPA fallback returns HTML ──
app.all('/api/*', (c) => c.json({ error: `Route not found: ${c.req.method} ${c.req.path}` }, 404))

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

  const indexHtml = fs.readFileSync(path.join(FRONTEND_DIST, 'index.html'), 'utf8')
  app.get('*', (c) => c.html(indexHtml))
  logger.info('Serving frontend from ' + FRONTEND_DIST)
} else {
  app.notFound((c) => c.json({ error: `Route not found: ${c.req.method} ${c.req.path}` }, 404))
}

const PORT = Number(process.env.PORT) || 3001

const server = serve({ fetch: app.fetch, port: PORT }, (info) => {
  logger.info(`{{COMPANY_NAME}} Care API running on port ${info.port}`, {
    env: process.env.NODE_ENV || 'development',
    port: info.port,
  })
})

// Socket.IO
initializeSocket(server as any)

const shutdown = async (signal: string) => {
  logger.info(`${signal} received, shutting down gracefully`)
  process.exit(0)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

export { app, db, io }
