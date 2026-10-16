import { Hono } from 'hono'
import { authenticate } from '../middleware/auth.ts'
import { requireEnabledFeature } from '../middleware/enabledFeature.ts'
import { requirePermission } from '../middleware/permissions.ts'
import calltracking from '../services/calltracking.ts'
import { db } from '../../db/index.ts'
import { company } from '../../db/schema.ts'
import { eq } from 'drizzle-orm'
import { parseTwilioBody, verifyTwilioRequest, twilioConfigFor, verifyCallRailSignature, refuseUnverifiedWebhook } from '../shared/index.ts'

const app = new Hono()

// ============================================
// WEBHOOKS (no session — called by providers, so each one proves it IS the provider)
// ============================================
//
// Each verifies BEFORE it reads or writes anything; a forged or unsigned request is answered 403 and
// nothing else happens. Until 10/15 these accepted any caller — anyone with a companyId could write call-log
// rows, file Lead Inbox leads and make contacts — and the Twilio one read Twilio's form-encoded body
// as JSON, so a real Twilio call never got past c.req.json(). With no key configured: refused in
// production, allowed outside it (local dev, the test harness), and the 403 says which key is missing.
//
// The catch-all POST /webhook/:provider/:companyId is gone: it had no provider behind it ("Add
// provider-specific mapping here"), no screen or doc handed its URL out, and it wrote whatever it was
// sent straight into the call log.

/** The company row a webhook names — its CallRail signing key and its Twilio account. */
const companyRowFor = async (id: string) => {
  const [row] = await db.select().from(company).where(eq(company.id, id)).limit(1)
  return row || null
}

// CallRail signs the RAW body: Signature = Base64(HMAC-SHA1(signing key, body)). Read as text, verify, then parse.
app.post('/webhook/callrail/:companyId', async (c) => {
  const companyId = c.req.param('companyId')
  const raw = await c.req.text()
  const row: any = await companyRowFor(companyId)
  const v = verifyCallRailSignature(raw, c.req.header('signature'), row?.callrailSigningKey || undefined)
  if (!v.ok) return refuseUnverifiedWebhook(c, 'CallRail call webhook', v.reason)
  let body: any
  try { body = JSON.parse(raw) } catch { return c.json({ error: 'Body must be JSON' }, 400) }
  try {
    await calltracking.handleCallRailWebhook(companyId, body)
  } catch (error) {
    console.error('CallRail webhook error:', error)
  }
  return c.body(null, 200)
})

// Twilio posts application/x-www-form-urlencoded (JSON still read, for tools) and signs URL + sorted params
// with the account's auth token — the company's own (Settings › Integrations) or the platform's TWILIO_AUTH_TOKEN.
app.post('/webhook/twilio/:companyId', async (c) => {
  const companyId = c.req.param('companyId')
  const params = await parseTwilioBody(c)
  const row = await companyRowFor(companyId)
  const v = verifyTwilioRequest(c, params, twilioConfigFor(row).authToken)
  if (!v.ok) return refuseUnverifiedWebhook(c, 'Twilio call webhook', v.reason)
  try {
    await calltracking.handleTwilioWebhook(companyId, params)
  } catch (error) {
    console.error('Twilio webhook error:', error)
  }
  return c.body(null, 200)
})

// Apply auth to remaining routes
app.use('*', authenticate)
// Reading is gated too, not only writing: the viewer and field seats have no calltracking:read (E2E run 1, 10/14).
// Call Tracking off for this tenant → its own endpoints are refused, not just hidden in the menu. Registered after
// the provider webhooks above, which stay public so inbound calls keep working. (Landscaping T14 M4 → #206)
app.use('*', requireEnabledFeature('call_tracking'))

// ============================================
// TRACKING NUMBERS
// ============================================

app.get('/numbers', requirePermission('calltracking:read'), async (c) => {
  const user = c.get('user') as any
  const source = c.req.query('source')
  const active = c.req.query('active')
  const numbers = await calltracking.getTrackingNumbers(user.companyId, {
    source,
    active: active === 'false' ? false : active === 'all' ? null : true,
  })
  return c.json(numbers)
})

app.post('/numbers', requirePermission('calltracking:create'), async (c) => {
  const user = c.get('user') as any
  const body = await c.req.json()
  const number = await calltracking.createTrackingNumber(user.companyId, body)
  return c.json(number, 201)
})

app.put('/numbers/:id', requirePermission('calltracking:update'), async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const body = await c.req.json()
  await calltracking.updateTrackingNumber(id, user.companyId, body)
  return c.json({ success: true })
})

// ============================================
// CALLS
// ============================================

app.get('/calls', requirePermission('calltracking:read'), async (c) => {
  const user = c.get('user') as any
  const { source, status, startDate, endDate, contactId, firstTimeOnly, page, limit } = c.req.query() as any
  const calls = await calltracking.getCalls(user.companyId, {
    source,
    status,
    startDate,
    endDate,
    contactId,
    firstTimeOnly: firstTimeOnly === 'true',
    page: parseInt(page) || 1,
    limit: parseInt(limit) || 50,
  })
  return c.json(calls)
})

app.get('/calls/:id', requirePermission('calltracking:read'), async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const call = await calltracking.getCall(id, user.companyId)
  if (!call) return c.json({ error: 'Call not found' }, 404)
  return c.json(call)
})

app.put('/calls/:id', requirePermission('calltracking:update'), async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const body = await c.req.json()
  await calltracking.updateCall(id, user.companyId, body)
  return c.json({ success: true })
})

app.post('/calls/:id/lead', requirePermission('calltracking:create'), async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const body = await c.req.json()
  await calltracking.tagCallAsLead(id, user.companyId, body)
  return c.json({ success: true })
})

app.post('/calls', requirePermission('calltracking:create'), async (c) => {
  const user = c.get('user') as any
  const body = await c.req.json()
  const call = await calltracking.logCall(user.companyId, body)
  return c.json(call, 201)
})

// ============================================
// REPORTS
// ============================================

app.get('/reports/attribution', requirePermission('calltracking:read'), async (c) => {
  const user = c.get('user') as any
  const { startDate, endDate } = c.req.query() as any
  const report = await calltracking.getAttributionReport(user.companyId, {
    startDate,
    endDate,
  })
  return c.json(report)
})

app.get('/reports/volume', requirePermission('calltracking:read'), async (c) => {
  const user = c.get('user') as any
  const { startDate, endDate, groupBy } = c.req.query() as any
  const report = await calltracking.getCallVolumeReport(user.companyId, {
    startDate,
    endDate,
    groupBy,
  })
  return c.json(report)
})

// ============================================
// SETTINGS — the CallRail signing key
// ============================================
//
// Pasted by the owner and admins — integrations:update, the right every other integration credential asks. Write-only: GET answers whether one is SET, never the key, and the company
// responses strip the column (COMPANY_SECRETS). Without it, production refuses every CallRail webhook.

const webhookOrigin = (c: any) => String(process.env.FRONTEND_URL || new URL(c.req.url).origin).replace(/\/+$/, '').replace(/^http:\/\//, 'https://')

app.get('/settings', requirePermission('integrations:update'), async (c) => {
  const user = c.get('user') as any
  const row: any = await companyRowFor(user.companyId)
  return c.json({
    callrailSigningKeySet: !!row?.callrailSigningKey,
    callrailWebhookUrl: `${webhookOrigin(c)}/api/calltracking/webhook/callrail/${user.companyId}`,
  })
})

app.put('/settings', requirePermission('integrations:update'), async (c) => {
  const user = c.get('user') as any
  const body = (await c.req.json().catch(() => null)) as any
  if (!body || typeof body !== 'object' || !('callrailSigningKey' in body)) return c.json({ error: 'Send callrailSigningKey (a string, or null to remove it)' }, 400)
  const v = body.callrailSigningKey
  let key: string | null = null
  if (v === null || (typeof v === 'string' && v.trim() === '')) key = null
  else if (typeof v === 'string' && /^[\x21-\x7e]{8,200}$/.test(v.trim())) key = v.trim()
  else return c.json({ error: 'That is not a CallRail signing key — copy the signing key from the webhook settings in your CallRail account, 8 to 200 characters, no spaces' }, 400)
  await db.update(company).set({ callrailSigningKey: key, updatedAt: new Date() } as any).where(eq(company.id, user.companyId))
  return c.json({ callrailSigningKeySet: !!key })
})

export default app
