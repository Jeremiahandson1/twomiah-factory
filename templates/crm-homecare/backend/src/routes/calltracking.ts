import { Hono } from 'hono'
import { authenticate, requireAdmin } from '../middleware/auth.ts'
import calltracking from '../services/calltracking.ts'

const app = new Hono()

// ============================================
// WEBHOOKS (No auth - called by providers)
// ============================================

app.post('/webhook/callrail/:agencyId', async (c) => {
  const agencyId = c.req.param('agencyId')
  const body = await c.req.json()
  try {
    await calltracking.handleCallRailWebhook(agencyId, body)
  } catch (error) {
    console.error('CallRail webhook error:', error)
  }
  return c.body(null, 200)
})

app.post('/webhook/twilio/:agencyId', async (c) => {
  const agencyId = c.req.param('agencyId')
  const body = await c.req.json()
  try {
    await calltracking.handleTwilioWebhook(agencyId, body)
  } catch (error) {
    console.error('Twilio webhook error:', error)
  }
  return c.body(null, 200)
})

app.post('/webhook/:provider/:agencyId', async (c) => {
  const provider = c.req.param('provider')
  const agencyId = c.req.param('agencyId')
  const body = await c.req.json()
  try {
    const data = mapProviderPayload(provider, body)
    await calltracking.logCall(agencyId, data)
  } catch (error) {
    console.error('Call tracking webhook error:', error)
  }
  return c.body(null, 200)
})

function mapProviderPayload(provider: string, payload: any) {
  // Add provider-specific mapping here
  return payload
}

// Apply auth to remaining routes
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

export default app
