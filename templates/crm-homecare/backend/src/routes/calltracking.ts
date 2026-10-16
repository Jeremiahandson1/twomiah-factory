import { Hono } from 'hono'
import { authenticate, requireAdmin } from '../middleware/auth.ts'
import calltracking from '../services/calltracking.ts'
import { db } from '../../db/index.ts'
import { agencies } from '../../db/schema.ts'
import { eq } from 'drizzle-orm'
import { parseTwilioBody, verifyTwilioRequest, twilioConfigFor, verifyCallRailSignature, refuseUnverifiedWebhook } from '../shared/index.ts'

const app = new Hono()

// ============================================
// WEBHOOKS (no session — called by providers, so each one proves it IS the provider)
// ============================================
//
// Each verifies BEFORE it reads or writes anything; a forged or unsigned request is answered 403 and
// nothing else happens. Until 10/15 these accepted any caller — anyone with a agencyId could write call-log
// rows, file Lead Inbox leads and make contacts — and the Twilio one read Twilio's form-encoded body
// as JSON, so a real Twilio call never got past c.req.json(). With no key configured: refused in
// production, allowed outside it (local dev, the test harness), and the 403 says which key is missing.
//
// The catch-all POST /webhook/:provider/:agencyId is gone: it had no provider behind it ("Add
// provider-specific mapping here"), no screen or doc handed its URL out, and it wrote whatever it was
// sent straight into the call log.

/** The agency row a webhook names — its CallRail signing key and its Twilio account. */
const companyRowFor = async (id: string) => {
  const [row] = await db.select().from(agencies).where(eq(agencies.id, id)).limit(1)
  return row || null
}

// CallRail signs the RAW body: Signature = Base64(HMAC-SHA1(signing key, body)). Read as text, verify, then parse.
app.post('/webhook/callrail/:agencyId', async (c) => {
  const agencyId = c.req.param('agencyId')
  const raw = await c.req.text()
  const row: any = await companyRowFor(agencyId)
  const v = verifyCallRailSignature(raw, c.req.header('signature'), row?.callrailSigningKey || undefined)
  if (!v.ok) return refuseUnverifiedWebhook(c, 'CallRail call webhook', v.reason)
  let body: any
  try { body = JSON.parse(raw) } catch { return c.json({ error: 'Body must be JSON' }, 400) }
  try {
    await calltracking.handleCallRailWebhook(agencyId, body)
  } catch (error) {
    console.error('CallRail webhook error:', error)
  }
  return c.body(null, 200)
})

// Twilio posts application/x-www-form-urlencoded (JSON still read, for tools) and signs URL + sorted params
// with the account's auth token — the company's own (Settings › Integrations) or the platform's TWILIO_AUTH_TOKEN.
app.post('/webhook/twilio/:agencyId', async (c) => {
  const agencyId = c.req.param('agencyId')
  const params = await parseTwilioBody(c)
  const row = await companyRowFor(agencyId)
  const v = verifyTwilioRequest(c, params, twilioConfigFor(row).authToken)
  if (!v.ok) return refuseUnverifiedWebhook(c, 'Twilio call webhook', v.reason)
  try {
    await calltracking.handleTwilioWebhook(agencyId, params)
  } catch (error) {
    console.error('Twilio webhook error:', error)
  }
  return c.body(null, 200)
})

// Tracking numbers, the call log and attribution reports are the office's. (The provider webhooks above stay public.)
// The agency is the token's companyId (routes/auth.ts signs { userId, email, role, companyId: agency.id }).
// These handlers read user.agencyId, which no homecare token carries: the id bound as undefined and
// every statement failed ("syntax error at or near ORDER" on the call log).
app.use('*', authenticate, requireAdmin)

// ============================================
// TRACKING NUMBERS
// ============================================

app.get('/numbers', async (c) => {
  const user = c.get('user') as any
  const source = c.req.query('source')
  const active = c.req.query('active')
  const numbers = await calltracking.getTrackingNumbers(user.companyId, {
    source,
    active: active === 'false' ? false : active === 'all' ? null : true,
  })
  return c.json(numbers)
})

app.post('/numbers', async (c) => {
  const user = c.get('user') as any
  const body = await c.req.json()
  const number = await calltracking.createTrackingNumber(user.companyId, body)
  return c.json(number, 201)
})

app.put('/numbers/:id', async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const body = await c.req.json()
  await calltracking.updateTrackingNumber(id, user.companyId, body)
  return c.json({ success: true })
})

// ============================================
// CALLS
// ============================================

app.get('/calls', async (c) => {
  const user = c.get('user') as any
  const { source, status, startDate, endDate, clientId, firstTimeOnly, page, limit } = c.req.query() as any
  const calls = await calltracking.getCalls(user.companyId, {
    source,
    status,
    startDate,
    endDate,
    clientId,
    firstTimeOnly: firstTimeOnly === 'true',
    page: parseInt(page) || 1,
    limit: parseInt(limit) || 50,
  })
  return c.json(calls)
})

app.get('/calls/:id', async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const call = await calltracking.getCall(id, user.companyId)
  if (!call) return c.json({ error: 'Call not found' }, 404)
  return c.json(call)
})

app.put('/calls/:id', async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const body = await c.req.json()
  await calltracking.updateCall(id, user.companyId, body)
  return c.json({ success: true })
})

app.post('/calls/:id/lead', async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const body = await c.req.json()
  await calltracking.tagCallAsLead(id, user.companyId, body)
  return c.json({ success: true })
})

app.post('/calls', async (c) => {
  const user = c.get('user') as any
  const body = await c.req.json()
  const call = await calltracking.logCall(user.companyId, body)
  return c.json(call, 201)
})

// ============================================
// REPORTS
// ============================================

app.get('/reports/attribution', async (c) => {
  const user = c.get('user') as any
  const { startDate, endDate } = c.req.query() as any
  const report = await calltracking.getAttributionReport(user.companyId, {
    startDate,
    endDate,
  })
  return c.json(report)
})

app.get('/reports/volume', async (c) => {
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
// Pasted by the office (requireAdmin above). Write-only: GET answers whether one is SET, never the key, and the company
// responses strip the column (COMPANY_SECRETS). Without it, production refuses every CallRail webhook.

const webhookOrigin = (c: any) => String(process.env.FRONTEND_URL || new URL(c.req.url).origin).replace(/\/+$/, '').replace(/^http:\/\//, 'https://')

app.get('/settings', async (c) => {
  const user = c.get('user') as any
  const row: any = await companyRowFor(user.companyId)
  return c.json({
    callrailSigningKeySet: !!row?.callrailSigningKey,
    callrailWebhookUrl: `${webhookOrigin(c)}/api/calltracking/webhook/callrail/${user.companyId}`,
  })
})

app.put('/settings', async (c) => {
  const user = c.get('user') as any
  const body = (await c.req.json().catch(() => null)) as any
  if (!body || typeof body !== 'object' || !('callrailSigningKey' in body)) return c.json({ error: 'Send callrailSigningKey (a string, or null to remove it)' }, 400)
  const v = body.callrailSigningKey
  let key: string | null = null
  if (v === null || (typeof v === 'string' && v.trim() === '')) key = null
  else if (typeof v === 'string' && /^[\x21-\x7e]{8,200}$/.test(v.trim())) key = v.trim()
  else return c.json({ error: 'That is not a CallRail signing key — copy the signing key from the webhook settings in your CallRail account, 8 to 200 characters, no spaces' }, 400)
  await db.update(agencies).set({ callrailSigningKey: key, updatedAt: new Date() } as any).where(eq(agencies.id, user.companyId))
  return c.json({ callrailSigningKeySet: !!key })
})

export default app
