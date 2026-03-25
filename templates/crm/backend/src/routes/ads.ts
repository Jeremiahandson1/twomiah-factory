import { Hono } from 'hono'
import { authenticate } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

// ─── Proxy helper ───────────────────────────────────────────────────────────
// All ads data comes from the Twomiah Ads service. No mock data.

async function adsProxy(method: string, path: string, body?: any) {
  const adsUrl = process.env.ADS_URL
  const adsApiKey = process.env.ADS_API_KEY // Tenant-specific API key for the ads service
  if (!adsUrl) {
    return { error: 'Ads service not configured. Set ADS_URL environment variable.', notConfigured: true }
  }
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (adsApiKey) headers['Authorization'] = `ApiKey ${adsApiKey}`
    const res = await fetch(`${adsUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10000),
    })
    return await res.json()
  } catch (err) {
    console.error(`Ads proxy error [${method} ${path}]:`, err)
    return { error: 'Failed to reach ads service' }
  }
}

// ─── Auth / Settings ────────────────────────────────────────────────────────

app.get('/auth/mode', async (c) => {
  const result = await adsProxy('GET', '/auth/mode')
  return c.json(result || { mode: 'managed' })
})

app.put('/auth/mode', async (c) => {
  const body = await c.req.json()
  const result = await adsProxy('PUT', '/auth/mode', body)
  return c.json(result)
})

app.get('/auth/status', async (c) => {
  const result = await adsProxy('GET', '/auth/status')
  return c.json(result || { status: { google: false, meta: false, tiktok: false } })
})

app.get('/auth/connect-url/:platform', async (c) => {
  const platform = c.req.param('platform')
  const adsUrl = process.env.ADS_URL
  if (!adsUrl) return c.text('Ads service not configured', 500)

  // The ads service has public OAuth endpoints at /auth/{platform}?tenantId=xxx
  // These redirect to Google/Meta/TikTok OAuth — no auth needed
  const currentUser = c.get('user') as any
  const tenantId = currentUser.companyId
  const url = `${adsUrl}/auth/${platform}?tenantId=${tenantId}`
  return c.redirect(url)
})

app.delete('/auth/:platform', async (c) => {
  const platform = c.req.param('platform')
  const result = await adsProxy('DELETE', `/auth/${platform}`)
  return c.json(result)
})

// ─── Performance & Campaigns ────────────────────────────────────────────────

app.get('/performance', async (c) => {
  const range = c.req.query('range') || '30'
  const result = await adsProxy('GET', `/dashboard/performance?range=${range}`)
  if (result?.notConfigured) {
    return c.json({
      summary: { impressions: 0, clicks: 0, ctr: 0, spend: 0, leads: 0, costPerLead: 0 },
      daily: [],
      campaigns: [],
      notConfigured: true,
    })
  }
  return c.json(result)
})

app.get('/campaigns', async (c) => {
  const status = c.req.query('status') || 'all'
  const result = await adsProxy('GET', `/campaigns?status=${status}`)
  if (result?.notConfigured) {
    return c.json({ campaigns: [], notConfigured: true })
  }
  return c.json(result)
})

app.get('/pending-approvals', async (c) => {
  const result = await adsProxy('GET', '/campaigns/pending-approvals')
  if (result?.notConfigured) {
    return c.json({ approvals: [], count: 0, notConfigured: true })
  }
  return c.json(result)
})

// ─── Campaign Actions ───────────────────────────────────────────────────────

app.post('/campaigns/preview', async (c) => {
  const body = await c.req.json()
  const result = await adsProxy('POST', '/campaigns/preview', body)
  return c.json(result)
})

app.post('/campaigns/launch', async (c) => {
  const body = await c.req.json()
  const result = await adsProxy('POST', '/campaigns/launch', body)
  return c.json(result)
})

// ─── Photos & Templates ────────────────────────────────────────────────────

app.get('/photos', async (c) => {
  try {
    const currentUser = c.get('user') as any
    const { db } = await import('../../db/index.ts')
    const { sql } = await import('drizzle-orm')
    const result = await db.execute(sql`
      SELECT id, url, thumbnail_url, caption, category, created_at
      FROM documents
      WHERE company_id = ${currentUser.companyId}
        AND type IN ('photo', 'image')
      ORDER BY created_at DESC
      LIMIT 50
    `)
    return c.json({ photos: (result as any).rows || result })
  } catch {
    return c.json({ photos: [] })
  }
})

app.get('/templates', async (c) => {
  const result = await adsProxy('GET', '/campaigns/templates')
  return c.json(result || { templates: [] })
})

// ─── Approval Actions (/:id params — MUST come last) ───────────────────────

app.post('/:id/approve', async (c) => {
  const id = c.req.param('id')
  const result = await adsProxy('POST', `/campaigns/${id}/approve`)
  return c.json(result)
})

app.post('/:id/request-changes', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()
  const result = await adsProxy('POST', `/campaigns/${id}/request-changes`, body)
  return c.json(result)
})

app.post('/:id/images', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()
  const result = await adsProxy('POST', `/campaigns/${id}/images`, body)
  return c.json(result)
})

app.post('/:id/pause', async (c) => {
  const id = c.req.param('id')
  const result = await adsProxy('POST', `/campaigns/${id}/pause`)
  return c.json(result)
})

app.post('/:id/resume', async (c) => {
  const id = c.req.param('id')
  const result = await adsProxy('POST', `/campaigns/${id}/resume`)
  return c.json(result)
})

export default app
