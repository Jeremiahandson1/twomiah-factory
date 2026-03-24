import { Hono } from 'hono'
import { authenticate } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

// ─── Mock data generators ────────────────────────────────────────────────────
// These return realistic mock data. Replace with real Twomiah Ads API calls later.

function generateDailyData(days: number) {
  const data = []
  const now = new Date()
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(now)
    date.setDate(date.getDate() - i)
    const impressions = Math.floor(800 + Math.random() * 1200)
    const clicks = Math.floor(impressions * (0.02 + Math.random() * 0.04))
    data.push({
      date: date.toISOString().split('T')[0],
      impressions,
      clicks,
    })
  }
  return data
}

const MOCK_CAMPAIGNS = [
  {
    id: 'camp_1',
    name: 'Google Search — Emergency Services',
    platform: 'google',
    status: 'active',
    impressions: 24500,
    clicks: 980,
    spend: 1247.50,
    leads: 42,
    budget: 2000,
    startDate: '2026-02-01',
    ads: [
      { id: 'ad_1', headline: '24/7 Emergency Plumbing', body: 'Licensed & insured. Same-day service. Call now for a free estimate!', imageUrl: null, cta: 'Call Now', status: 'active' },
      { id: 'ad_2', headline: 'Fast AC Repair Near You', body: 'Top-rated HVAC service. No overtime charges. Book online today.', imageUrl: null, cta: 'Book Now', status: 'active' },
    ],
  },
  {
    id: 'camp_2',
    name: 'Meta — Kitchen Remodel Leads',
    platform: 'meta',
    status: 'active',
    impressions: 18200,
    clicks: 546,
    spend: 892.30,
    leads: 28,
    budget: 1500,
    startDate: '2026-02-10',
    ads: [
      { id: 'ad_3', headline: 'Dream Kitchen Awaits', body: 'Transform your kitchen with our award-winning design team. Free consultations this month.', imageUrl: null, cta: 'Get Free Quote', status: 'active' },
      { id: 'ad_4', headline: 'Kitchen Remodel — 0% Financing', body: 'Beautiful kitchens, affordable payments. See our portfolio of 500+ completed projects.', imageUrl: null, cta: 'See Portfolio', status: 'paused' },
    ],
  },
  {
    id: 'camp_3',
    name: 'Google Local Services',
    platform: 'google',
    status: 'paused',
    impressions: 8400,
    clicks: 252,
    spend: 445.00,
    leads: 15,
    budget: 1000,
    startDate: '2026-01-15',
    ads: [
      { id: 'ad_5', headline: 'Trusted Local Contractor', body: 'Google Guaranteed. 5-star rated. Serving the greater metro area.', imageUrl: null, cta: 'Get Quote', status: 'paused' },
    ],
  },
  {
    id: 'camp_4',
    name: 'Meta — Spring Promotion',
    platform: 'meta',
    status: 'draft',
    impressions: 0,
    clicks: 0,
    spend: 0,
    leads: 0,
    budget: 800,
    startDate: '2026-03-15',
    ads: [
      { id: 'ad_6', headline: 'Spring Special: 15% Off', body: 'Book your spring project now and save. Limited time offer.', imageUrl: null, cta: 'Claim Offer', status: 'draft' },
    ],
  },
]

const MOCK_PENDING_APPROVALS = [
  {
    id: 'pending_1',
    campaignId: 'camp_2',
    campaignName: 'Meta — Kitchen Remodel Leads',
    platform: 'meta',
    headline: 'Luxury Kitchen Makeover — Free 3D Design',
    body: 'See your dream kitchen before construction begins. Our 3D visualization tool lets you preview every detail. Schedule your free design consultation today.',
    imageUrl: null,
    cta: 'Book Consultation',
    createdAt: '2026-03-07T14:30:00Z',
    status: 'pending',
  },
  {
    id: 'pending_2',
    campaignId: 'camp_1',
    campaignName: 'Google Search — Emergency Services',
    platform: 'google',
    headline: 'Water Heater Install — Same Day',
    body: 'Professional water heater installation. Licensed plumbers, warranty included. Emergency service available.',
    imageUrl: null,
    cta: 'Call Now',
    createdAt: '2026-03-08T09:15:00Z',
    status: 'pending',
  },
]

// In-memory store for approvals/rejections (mock — replace with DB later)
const approvalStore = new Map<string, { status: string; feedback?: string }>()

// ─── Routes ──────────────────────────────────────────────────────────────────

app.get('/performance', async (c) => {
  const range = c.req.query('range') || '30'
  const days = Math.min(Number(range) || 30, 90)
  const daily = generateDailyData(days)

  const totalImpressions = daily.reduce((s, d) => s + d.impressions, 0)
  const totalClicks = daily.reduce((s, d) => s + d.clicks, 0)
  const totalSpend = MOCK_CAMPAIGNS.reduce((s, c) => s + c.spend, 0)
  const totalLeads = MOCK_CAMPAIGNS.reduce((s, c) => s + c.leads, 0)

  return c.json({
    summary: {
      impressions: totalImpressions,
      clicks: totalClicks,
      ctr: totalClicks / Math.max(totalImpressions, 1),
      spend: totalSpend,
      leads: totalLeads,
      costPerLead: totalSpend / Math.max(totalLeads, 1),
    },
    daily,
    campaigns: MOCK_CAMPAIGNS.filter(c => c.status !== 'draft').map(camp => ({
      id: camp.id,
      name: camp.name,
      platform: camp.platform,
      status: camp.status,
      impressions: camp.impressions,
      clicks: camp.clicks,
      ctr: camp.clicks / Math.max(camp.impressions, 1),
      spend: camp.spend,
      leads: camp.leads,
    })),
  })
})

app.get('/campaigns', async (c) => {
  const status = c.req.query('status')
  let campaigns = MOCK_CAMPAIGNS
  if (status && status !== 'all') {
    campaigns = campaigns.filter(camp => camp.status === status)
  }

  return c.json({
    campaigns: campaigns.map(camp => ({
      ...camp,
      ads: camp.ads.map(ad => ({
        ...ad,
        // Merge any approval state
        ...(approvalStore.has(ad.id) ? { status: approvalStore.get(ad.id)!.status === 'approved' ? 'active' : ad.status } : {}),
      })),
    })),
  })
})

app.get('/pending-approvals', async (c) => {
  const pending = MOCK_PENDING_APPROVALS.filter(p => {
    const stored = approvalStore.get(p.id)
    return !stored || stored.status === 'pending'
  })
  return c.json({ approvals: pending, count: pending.length })
})

// ─── Proxy to Twomiah Ads service ────────────────────────────────────────────
// MUST be registered BEFORE /:id routes to avoid param catch-all conflicts

async function adsProxy(method: string, path: string, body?: any) {
  const adsUrl = process.env.ADS_URL
  if (!adsUrl) return null
  try {
    const res = await fetch(`${adsUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10000),
    })
    return await res.json()
  } catch (err) {
    console.error(`Ads proxy error [${method} ${path}]:`, err)
    return null
  }
}

app.get('/auth/mode', async (c) => {
  const result = await adsProxy('GET', '/auth/mode')
  return c.json(result || { mode: 'managed' })
})

app.put('/auth/mode', async (c) => {
  const body = await c.req.json()
  const result = await adsProxy('PUT', '/auth/mode', body)
  return c.json(result || { success: false, error: 'Ads service not configured' })
})

app.get('/auth/status', async (c) => {
  const result = await adsProxy('GET', '/auth/status')
  return c.json(result || { status: { google: false, meta: false, tiktok: false } })
})

app.get('/auth/connect-url/:platform', async (c) => {
  const platform = c.req.param('platform')
  const result = await adsProxy('GET', `/auth/connect-url/${platform}`)
  return c.json(result || { error: 'Ads service not configured' })
})

app.delete('/auth/:platform', async (c) => {
  const platform = c.req.param('platform')
  const result = await adsProxy('DELETE', `/auth/${platform}`)
  return c.json(result || { success: false })
})

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

// ─── Approval routes (/:id params — MUST come after specific routes) ────────

app.post('/:id/approve', async (c) => {
  const id = c.req.param('id')
  approvalStore.set(id, { status: 'approved' })

  // In production: notify Twomiah Ads service
  const adsUrl = process.env.ADS_URL
  if (adsUrl) {
    try {
      await fetch(`${adsUrl}/api/webhooks/ad-approved`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adId: id, approvedAt: new Date().toISOString() }),
        signal: AbortSignal.timeout(5000),
      })
    } catch (err) {
      console.error('Failed to notify Ads service:', err)
    }
  }

  return c.json({ success: true, status: 'approved' })
})

app.post('/:id/request-changes', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()
  const feedback = body?.feedback || ''
  approvalStore.set(id, { status: 'changes_requested', feedback })

  // In production: notify Twomiah Ads service
  const adsUrl = process.env.ADS_URL
  if (adsUrl) {
    try {
      await fetch(`${adsUrl}/api/webhooks/ad-changes-requested`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adId: id, feedback, requestedAt: new Date().toISOString() }),
        signal: AbortSignal.timeout(5000),
      })
    } catch (err) {
      console.error('Failed to notify Ads service:', err)
    }
  }

  return c.json({ success: true, status: 'changes_requested' })
})

export default app
