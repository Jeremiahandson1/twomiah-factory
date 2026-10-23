// /api/calltracking — tracking numbers, the call log, the attribution reports, the CallRail signing key, and the
// providers' call webhooks. Moved from templates/crm/backend/src/routes/calltracking.ts.
//
// Mounted public: the two provider webhooks answer without a session and prove they ARE the provider (signature
// checked before anything is read or written; unsigned/forged → 403). Everything after them signs the person in and
// needs Call Tracking switched on (or, where the vertical sells no Call Tracking, the AI Receptionist —
// CrmSettings.callTrackingSwitch) — here, inside the router, as the template ordered it, so a tenant with the switch
// off still logs the calls its providers send.
import { Hono } from 'hono'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { parseTwilioBody, verifyTwilioRequest, twilioConfigFor, verifyCallRailSignature, refuseUnverifiedWebhook } from '@twomiah/tenant-backend'
import { company } from '../../db/schema/index.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, list, one, done, listAll } from '../../http/reply.ts'
import { invalid } from '../../http/errors.ts'
import type { CrmDeps } from '../deps.ts'
import { createCalltrackingService } from './calltrackingService.ts'

const trackingNumberSchema = z.object({
  phoneNumber: z.string().trim().min(1, 'The tracking phone number is required'),
  forwardTo: z.string().optional(),
  source: z.string().optional(),
  campaign: z.string().optional(),
  medium: z.string().optional(),
  name: z.string().optional(),
  providerId: z.string().optional(),
})

export function createCalltrackingRoutes(d: CrmDeps) {
  const { db, logger } = d
  const { requirePermission } = d.permissions
  const calltracking = createCalltrackingService(d)
  const app = new Hono<AppEnv>()

  /** The company row a webhook names — its CallRail signing key and its Twilio account. */
  const companyRowFor = async (id: string) => {
    const [row] = await db.select().from(company).where(eq(company.id, id)).limit(1)
    return row || null
  }

  // ── Webhooks (no session) ──

  // CallRail signs the RAW body: Signature = Base64(HMAC-SHA1(signing key, body)). Read as text, verify, then parse.
  app.post('/webhook/callrail/:companyId', async (c) => {
    const companyId = c.req.param('companyId')
    const raw = await c.req.text()
    const row: any = await companyRowFor(companyId)
    const v = verifyCallRailSignature(raw, c.req.header('signature'), row?.callrailSigningKey || undefined)
    if (!v.ok) return refuseUnverifiedWebhook(c, 'CallRail call webhook', v.reason)
    let body: any
    try { body = JSON.parse(raw) } catch { return fail(c, 400, 'Body must be JSON') }
    try {
      await calltracking.handleCallRailWebhook(companyId, body)
    } catch (error: any) {
      logger.error('CallRail webhook error', { error: error?.message })
    }
    return c.body(null, 200)
  })

  // Twilio posts application/x-www-form-urlencoded (JSON still read, for tools) and signs URL + sorted params with
  // the account's auth token — the company's own (Settings › Integrations) or the platform's TWILIO_AUTH_TOKEN.
  app.post('/webhook/twilio/:companyId', async (c) => {
    const companyId = c.req.param('companyId')
    const params = await parseTwilioBody(c)
    const row = await companyRowFor(companyId)
    const v = verifyTwilioRequest(c, params, twilioConfigFor(row).authToken)
    if (!v.ok) return refuseUnverifiedWebhook(c, 'Twilio call webhook', v.reason)
    try {
      await calltracking.handleTwilioWebhook(companyId, params)
    } catch (error: any) {
      logger.error('Twilio webhook error', { error: error?.message })
    }
    return c.body(null, 200)
  })

  // ── Signed in, and Call Tracking on (the AI Receptionist, where that is the switch) ──
  app.use('*', d.authenticate)
  app.use('*', d.features.requireEnabledFeature(d.settings?.callTrackingSwitch ?? 'call_tracking'))

  // Tracking numbers
  app.get('/numbers', requirePermission('calltracking:read'), async (c) => {
    const user = c.get('user')
    const active = c.req.query('active')
    const numbers = await calltracking.getTrackingNumbers(user.companyId, {
      source: c.req.query('source'),
      active: active === 'false' ? false : active === 'all' ? null : true,
    })
    return listAll(c, numbers)
  })

  app.post('/numbers', requirePermission('calltracking:create'), async (c) => {
    const user = c.get('user')
    // The number is required (the template inserted whatever came, and a missing one broke the INSERT: a 500).
    const parsed = trackingNumberSchema.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return invalid(c, parsed.error)
    const number = await calltracking.createTrackingNumber(user.companyId, parsed.data)
    return one(c, number, 201)
  })

  app.put('/numbers/:id', requirePermission('calltracking:update'), async (c) => {
    const user = c.get('user')
    const body = await c.req.json()
    await calltracking.updateTrackingNumber(c.req.param('id'), user.companyId, body)
    return done(c)
  })

  // Calls
  app.get('/calls', requirePermission('calltracking:read'), async (c) => {
    const user = c.get('user')
    // clientId: home care's call log filters by client (CrmSettings.callers).
    const { source, status, startDate, endDate, contactId, clientId, firstTimeOnly, page, limit } = c.req.query() as any
    const r = await calltracking.getCalls(user.companyId, {
      source, status, startDate, endDate, contactId, clientId,
      firstTimeOnly: firstTimeOnly === 'true',
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 50,
    })
    return list(c, r.data, { page: r.page, limit: r.limit, total: r.total })
  })

  app.get('/calls/:id', requirePermission('calltracking:read'), async (c) => {
    const user = c.get('user')
    const call = await calltracking.getCall(c.req.param('id'), user.companyId)
    if (!call) return fail(c, 404, 'Call not found')
    return one(c, call)
  })

  app.put('/calls/:id', requirePermission('calltracking:update'), async (c) => {
    const user = c.get('user')
    const body = await c.req.json()
    await calltracking.updateCall(c.req.param('id'), user.companyId, body)
    return done(c)
  })

  app.post('/calls/:id/lead', requirePermission('calltracking:create'), async (c) => {
    const user = c.get('user')
    const body = await c.req.json()
    await calltracking.tagCallAsLead(c.req.param('id'), user.companyId, body)
    return done(c)
  })

  app.post('/calls', requirePermission('calltracking:create'), async (c) => {
    const user = c.get('user')
    const body = await c.req.json()
    const call = await calltracking.logCall(user.companyId, body)
    return one(c, call, 201)
  })

  // Reports
  app.get('/reports/attribution', requirePermission('calltracking:read'), async (c) => {
    const user = c.get('user')
    const { startDate, endDate } = c.req.query() as any
    return one(c, await calltracking.getAttributionReport(user.companyId, { startDate, endDate }))
  })

  app.get('/reports/volume', requirePermission('calltracking:read'), async (c) => {
    const user = c.get('user')
    const { startDate, endDate, groupBy } = c.req.query() as any
    const report = await calltracking.getCallVolumeReport(user.companyId, { startDate, endDate, groupBy })
    return listAll(c, report)
  })

  // Settings — the CallRail signing key. Owner and admins (integrations:update). Write-only: GET answers whether one
  // is SET, never the key; without it, production refuses every CallRail webhook.
  const webhookOrigin = (c: any) => String(process.env.FRONTEND_URL || new URL(c.req.url).origin).replace(/\/+$/, '').replace(/^http:\/\//, 'https://')

  app.get('/settings', requirePermission('integrations:update'), async (c) => {
    const user = c.get('user')
    const row: any = await companyRowFor(user.companyId)
    return one(c, {
      callrailSigningKeySet: !!row?.callrailSigningKey,
      callrailWebhookUrl: `${webhookOrigin(c)}/api/calltracking/webhook/callrail/${user.companyId}`,
    })
  })

  app.put('/settings', requirePermission('integrations:update'), async (c) => {
    const user = c.get('user')
    const body = (await c.req.json().catch(() => null)) as any
    if (!body || typeof body !== 'object' || !('callrailSigningKey' in body)) return fail(c, 400, 'Send callrailSigningKey (a string, or null to remove it)')
    const v = body.callrailSigningKey
    let key: string | null = null
    if (v === null || (typeof v === 'string' && v.trim() === '')) key = null
    else if (typeof v === 'string' && /^[\x21-\x7e]{8,200}$/.test(v.trim())) key = v.trim()
    else return fail(c, 400, 'That is not a CallRail signing key — copy the signing key from the webhook settings in your CallRail account, 8 to 200 characters, no spaces')
    await db.update(company).set({ callrailSigningKey: key, updatedAt: new Date() } as any).where(eq(company.id, user.companyId))
    return one(c, { callrailSigningKeySet: !!key })
  })

  return app
}
